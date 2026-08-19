#!/usr/bin/env python3
"""GarageLog fuel-pump transaction display reader - lab tuned-v12.


This reader is intentionally transaction-specific. It looks for a completed-sale
pair (Total/This Sale above Gallons), reads those two seven-segment rows, and
returns only the sale amount and gallons. Pump grade price boards are rejected.
"""
import cv2
import json
import numpy as np
import sys

# Transaction sanity range. This is not an OCR target; it only rejects
# decoded sale/gallons pairs that imply an implausible pump price.
# The current GarageLog field-use target is contemporary US fuel transactions.
MIN_DERIVED_PPG = 1.50
MAX_DERIVED_PPG = 7.50

def valid_derived_ppg(amount, gallons):
    if gallons is None or gallons <= 0:
        return False
    price = float(amount) / float(gallons)
    return MIN_DERIVED_PPG <= price <= MAX_DERIVED_PPG

DIGIT_SEGMENTS = {
    0: (1, 1, 1, 1, 1, 1, 0),
    1: (0, 1, 1, 0, 0, 0, 0),
    2: (1, 1, 0, 1, 1, 0, 1),
    3: (1, 1, 1, 1, 0, 0, 1),
    4: (0, 1, 1, 0, 0, 1, 1),
    5: (1, 0, 1, 1, 0, 1, 1),
    6: (1, 0, 1, 1, 1, 1, 1),
    7: (1, 1, 1, 0, 0, 0, 0),
    8: (1, 1, 1, 1, 1, 1, 1),
    9: (1, 1, 1, 1, 0, 1, 1),
}


def iou(a, b):
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    x1, y1 = max(ax, bx), max(ay, by)
    x2, y2 = min(ax + aw, bx + bw), min(ay + ah, by + bh)
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    return inter / float(aw * ah + bw * bh - inter + 1e-9)


def order_points(points):
    pts = np.asarray(points, dtype=np.float32).reshape(4, 2)
    sums = pts.sum(axis=1)
    diffs = np.diff(pts, axis=1).ravel()
    return np.array(
        [pts[np.argmin(sums)], pts[np.argmin(diffs)], pts[np.argmax(sums)], pts[np.argmax(diffs)]],
        dtype=np.float32,
    )


def warp_quad(image, points):
    quad = order_points(points)
    tl, tr, br, bl = quad
    width = int(max(np.linalg.norm(br - bl), np.linalg.norm(tr - tl)))
    height = int(max(np.linalg.norm(tr - br), np.linalg.norm(tl - bl)))
    if width < 50 or height < 25:
        return None
    target = np.array(
        [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]],
        dtype=np.float32,
    )
    matrix = cv2.getPerspectiveTransform(quad, target)
    return cv2.warpPerspective(image, matrix, (width, height))


def panel_candidates(image):
    """Return likely display panels as (score, bbox, quad)."""
    h, w = image.shape[:2]
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    masks = []
    # Strongly colored LCD/LED panels (blue, amber, green, red).
    saturated = cv2.inRange(hsv, np.array([0, 45, 25]), np.array([179, 255, 255]))
    saturated = cv2.morphologyEx(saturated, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    masks.append((saturated, 1.15))

    # Framed monochrome LCD panels.
    edges = cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), 35, 125)
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    masks.append((edges, 1.0))

    found = []
    for mask, weight in masks:
        contours, _ = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            area = cv2.contourArea(contour)
            if area < h * w * 0.025 or area > h * w * 0.92:
                continue
            perimeter = cv2.arcLength(contour, True)
            approx = cv2.approxPolyDP(contour, 0.03 * perimeter, True)
            if len(approx) == 4:
                quad = approx.reshape(4, 2)
            else:
                x, y, cw, ch = cv2.boundingRect(contour)
                quad = np.array([[x, y], [x + cw, y], [x + cw, y + ch], [x, y + ch]])

            x, y, cw, ch = cv2.boundingRect(quad)
            aspect = cw / float(max(ch, 1))
            if cw < w * 0.20 or ch < h * 0.055 or not 0.9 < aspect < 10:
                continue
            rectangularity = area / float(max(1, cw * ch))
            score = area * weight * max(0.35, min(1.0, rectangularity))
            found.append((score, (x, y, cw, ch), quad))

    found.sort(key=lambda item: item[0], reverse=True)
    unique = []
    for item in found:
        if all(iou(item[1], existing[1]) < 0.72 for existing in unique):
            unique.append(item)
    return unique[:16]


def choose_binary(crop):
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if crop.ndim == 3 else crop.copy()
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    gray = clahe.apply(gray)
    choices = []
    for inverted in (False, True):
        threshold_type = cv2.THRESH_BINARY_INV if inverted else cv2.THRESH_BINARY
        _, binary = cv2.threshold(gray, 0, 255, threshold_type + cv2.THRESH_OTSU)
        binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
        binary[:1, :] = 0
        binary[-1:, :] = 0
        binary[:, :1] = 0
        binary[:, -1:] = 0
        foreground = float(np.mean(binary > 0))
        count, _, stats, _ = cv2.connectedComponentsWithStats(binary, 8)
        digit_like = 0
        bh, bw = binary.shape
        for i in range(1, count):
            x, y, cw, ch, area = stats[i]
            if ch >= bh * 0.18 and area >= bh * bw * 0.001 and cw <= bw * 0.45:
                digit_like += 1
        score = digit_like * 2.0 - abs(foreground - 0.18) * 10.0
        if foreground > 0.55 or foreground < 0.008:
            score -= 20
        choices.append((score, binary))
    return max(choices, key=lambda item: item[0])[1]


def group_digit_boxes(binary):
    """Group connected seven-segment pieces into one box per digit."""
    h, w = binary.shape
    count, _, stats, _ = cv2.connectedComponentsWithStats(binary, 8)
    components = []
    dots = []
    for i in range(1, count):
        x, y, cw, ch, area = [int(v) for v in stats[i]]
        if area < max(6, h * w * 0.0007):
            continue
        if cw > w * 0.60 or ch > h * 0.98:
            continue
        if ch < h * 0.20:
            if y > h * 0.42 and cw <= h * 0.28:
                dots.append((x, y, cw, ch, area))
            continue
        components.append([x, y, cw, ch, area])

    components.sort(key=lambda item: item[0])
    groups = []
    for comp in components:
        x, y, cw, ch, area = comp
        cx = x + cw / 2.0
        chosen = None
        for index, group in enumerate(groups):
            gx, gy, gw, gh, garea = group
            gcx = gx + gw / 2.0
            overlap = max(0, min(x + cw, gx + gw) - max(x, gx)) / float(max(1, min(cw, gw)))
            if overlap > 0.35 or abs(cx - gcx) < max(3, h * 0.055):
                chosen = index
                break
        if chosen is None:
            groups.append(comp[:])
        else:
            gx, gy, gw, gh, garea = groups[chosen]
            nx, ny = min(gx, x), min(gy, y)
            nr, nb = max(gx + gw, x + cw), max(gy + gh, y + ch)
            groups[chosen] = [nx, ny, nr - nx, nb - ny, garea + area]

    groups = [
        group
        for group in groups
        if group[3] >= h * 0.43 or (group[3] >= h * 0.30 and group[2] <= h * 0.28)
    ]
    groups.sort(key=lambda item: item[0])

    # Remove obvious frame/edge artifacts far from the digit run.
    if len(groups) >= 3:
        heights = np.array([g[3] for g in groups], dtype=float)
        median_height = float(np.median(heights))
        groups = [g for g in groups if g[3] >= median_height * 0.55]

    return groups, dots


def digit_from_box(binary, box):
    x, y, w, h, _ = box
    pad_x = max(1, int(w * 0.05))
    pad_y = max(1, int(h * 0.03))
    roi = binary[
        max(0, y - pad_y) : min(binary.shape[0], y + h + pad_y),
        max(0, x - pad_x) : min(binary.shape[1], x + w + pad_x),
    ]
    if roi.size == 0:
        return None
    roi = cv2.resize(roi, (70, 120), interpolation=cv2.INTER_NEAREST)

    # Point/patch probes are much less sensitive to segment thickness than
    # contour-shape classification. Order: a,b,c,d,e,f,g.
    probes = [
        (0.50, 0.10),
        (0.82, 0.30),
        (0.82, 0.70),
        (0.50, 0.90),
        (0.18, 0.70),
        (0.18, 0.30),
        (0.50, 0.50),
    ]
    values = []
    for px, py in probes:
        cx, cy = int(px * 70), int(py * 120)
        rx, ry = 6, 8
        patch = roi[max(0, cy - ry) : min(120, cy + ry), max(0, cx - rx) : min(70, cx + rx)]
        values.append(float(np.mean(patch > 0)))

    best = None
    for digit, expected in DIGIT_SEGMENTS.items():
        score = sum((1.0 - value if active else value) for value, active in zip(values, expected))
        if best is None or score < best[0]:
            best = (score, digit)
    return best


def read_digit_row(crop, decimal_places):
    binary = choose_binary(crop)
    groups, dots = group_digit_boxes(binary)
    if len(groups) < 2 or len(groups) > 7:
        return None

    digits = []
    scores = []
    for group in groups:
        result = digit_from_box(binary, group)
        if result is None:
            return None
        score, digit = result
        if score > 3.35:
            return None
        digits.append(str(digit))
        scores.append(score)

    raw = "".join(digits)
    if len(raw) <= decimal_places:
        return None
    text = raw[:-decimal_places] + "." + raw[-decimal_places:]
    try:
        value = float(text)
    except ValueError:
        return None

    mean_score = float(np.mean(scores)) if scores else 99.0
    confidence = max(0.0, min(1.0, 1.0 - mean_score / 4.0))
    return value, confidence, text


def row_bands(panel):
    """Find two large numeric rows inside one shared transaction panel."""
    binary = choose_binary(panel)
    h, w = binary.shape
    count, _, stats, _ = cv2.connectedComponentsWithStats(binary, 8)
    items = []
    for i in range(1, count):
        x, y, cw, ch, area = [int(v) for v in stats[i]]
        if ch < h * 0.09 or ch > h * 0.78:
            continue
        if area < h * w * 0.0008 or cw > w * 0.50:
            continue
        items.append((x, y, cw, ch, area))
    if not items:
        return []

    clusters = []
    for item in sorted(items, key=lambda q: q[1] + q[3] / 2.0):
        cy = item[1] + item[3] / 2.0
        placed = False
        for cluster in clusters:
            cluster_cy = float(np.median([q[1] + q[3] / 2.0 for q in cluster]))
            cluster_h = float(np.median([q[3] for q in cluster]))
            if abs(cy - cluster_cy) < max(h * 0.11, cluster_h * 0.70):
                cluster.append(item)
                placed = True
                break
        if not placed:
            clusters.append([item])

    bands = []
    for cluster in clusters:
        if len(cluster) < 2:
            continue
        x1 = max(0, min(q[0] for q in cluster) - 4)
        x2 = min(w, max(q[0] + q[2] for q in cluster) + 4)
        y1 = max(0, min(q[1] for q in cluster) - 4)
        y2 = min(h, max(q[1] + q[3] for q in cluster) + 4)
        if x2 - x1 < w * 0.16 or y2 - y1 < h * 0.13:
            continue
        bands.append((y1, y2, x1, x2, len(cluster)))

    if len(bands) < 2:
        # Practical fallback for shared two-line LCDs: each half must independently
        # decode as a multi-digit transaction value.
        midpoint = h // 2
        margin = max(2, int(h * 0.03))
        return [
            (0, min(h, midpoint + margin), 0, w, 0),
            (max(0, midpoint - margin), h, 0, w, 0),
        ]

    bands = sorted(bands, key=lambda b: b[0])
    if len(bands) > 2:
        strongest = sorted(bands, key=lambda b: (b[4], b[1] - b[0]), reverse=True)[:2]
        bands = sorted(strongest, key=lambda b: b[0])
    return bands[:2]


def read_shared_panel(panel):
    bands = row_bands(panel)
    if len(bands) != 2:
        return None
    top = bands[0]
    bottom = bands[1]
    amount = read_digit_row(panel[top[0] : top[1], top[2] : top[3]], 2)
    gallons = read_digit_row(panel[bottom[0] : bottom[1], bottom[2] : bottom[3]], 3)
    if amount is None or gallons is None:
        return None
    return amount, gallons


def read_separate_panels(image, candidates):
    best = None
    for i, first in enumerate(candidates[:12]):
        for second in candidates[i + 1 : 12]:
            _, a, qa = first
            _, b, qb = second
            top, bottom = (first, second) if a[1] <= b[1] else (second, first)
            _, ta, tq = top
            _, ba, bq = bottom
            overlap = max(0, min(ta[0] + ta[2], ba[0] + ba[2]) - max(ta[0], ba[0])) / float(max(1, min(ta[2], ba[2])))
            if overlap < 0.40:
                continue
            width_ratio = min(ta[2], ba[2]) / float(max(ta[2], ba[2]))
            vertical_gap = ba[1] - (ta[1] + ta[3])
            if width_ratio < 0.48 or vertical_gap > image.shape[0] * 0.42:
                continue
            top_panel = warp_quad(image, tq)
            bottom_panel = warp_quad(image, bq)
            if top_panel is None or bottom_panel is None:
                continue
            amount = read_digit_row(top_panel, 2)
            gallons = read_digit_row(bottom_panel, 3)
            if amount is None or gallons is None:
                continue
            score = top[0] + bottom[0]
            if best is None or score > best[0]:
                best = (score, amount, gallons)
    return None if best is None else (best[1], best[2])



def stacked_display_rectangles(image):
    """Detect two traditional stacked transaction LCD windows.

    This intentionally mirrors the conservative geometry that worked well for
    separate amber/gray sale and gallons windows before shared-panel support was
    added. It does not accept rows of grade-price boxes.
    """
    sh, sw = image.shape[:2]
    scale = min(1.0, 1400.0 / max(sw, 1))
    work = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1 else image.copy()
    gray = cv2.cvtColor(work, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    candidates = []

    edges = cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), 40, 140)
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    for contour in contours:
        x, y, cw, ch = cv2.boundingRect(contour)
        aspect = cw / float(max(ch, 1))
        if cw >= w * 0.25 and ch >= h * 0.05 and ch <= h * 0.42 and 2.0 < aspect < 9:
            candidates.append((x, y, cw, ch, cv2.contourArea(contour)))

    hsv = cv2.cvtColor(work, cv2.COLOR_BGR2HSV)
    amber = cv2.inRange(hsv, np.array([3, 55, 70]), np.array([50, 255, 255]))
    amber = cv2.morphologyEx(amber, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    contours, _ = cv2.findContours(amber, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for contour in contours:
        x, y, cw, ch = cv2.boundingRect(contour)
        aspect = cw / float(max(ch, 1))
        if cw > w * 0.25 and ch > h * 0.05 and ch < h * 0.42 and 2.0 < aspect < 9:
            candidates.append((x, y, cw, ch, cv2.contourArea(contour) + cw * ch * 0.2))

    candidates.sort(key=lambda item: item[4], reverse=True)
    chosen = []
    for candidate in candidates:
        box = candidate[:4]
        if all(iou(box, existing[:4]) < 0.45 for existing in chosen):
            chosen.append(candidate)

    best = None
    best_score = -1.0
    for i, first in enumerate(chosen[:12]):
        for second in chosen[i + 1 : 12]:
            top, bottom = (first, second) if first[1] <= second[1] else (second, first)
            overlap = max(0, min(top[0] + top[2], bottom[0] + bottom[2]) - max(top[0], bottom[0])) / float(max(1, min(top[2], bottom[2])))
            size = min(top[2], bottom[2]) / float(max(top[2], bottom[2]))
            gap = (bottom[1] - top[1]) / float(max(h, 1))
            if overlap < 0.45 or size < 0.50 or gap < 0.08 or gap > 0.72:
                continue
            score = overlap + size + ((top[2] + bottom[2]) / float(max(w, 1))) * 0.2
            if score > best_score:
                best_score = score
                best = (top, bottom)

    if best is None:
        return []
    inv = 1.0 / scale
    return [tuple(int(round(v * inv)) for v in item[:4]) for item in best]


def read_stacked_rectangles(image):
    rectangles = stacked_display_rectangles(image)
    if len(rectangles) != 2:
        return None
    reads = []
    for x, y, w, h in rectangles:
        crop = image[max(0, y) : min(image.shape[0], y + h), max(0, x) : min(image.shape[1], x + w)]
        reads.append(crop)
    amount = read_digit_row(reads[0], 2)
    gallons = read_digit_row(reads[1], 3)
    if amount is None or gallons is None:
        return None
    return amount, gallons

def validate_transaction(amount_read, gallons_read, method):
    amount, amount_confidence, amount_text = amount_read
    gallons, gallons_confidence, gallons_text = gallons_read
    if not (0.50 <= amount <= 1000.0 and 0.05 <= gallons <= 200.0):
        return None
    price = amount / gallons
    # This is validation only. GarageLog does not OCR/store a pump grade price.
    if not valid_derived_ppg(amount, gallons):
        return None
    confidence = min(amount_confidence, gallons_confidence)
    return {
        "success": True,
        "method": method,
        "amount": round(amount, 2),
        "gallons": round(gallons, 4),
        "pricePerGallon": round(price, 3),
        "confidence": "high" if confidence >= 0.62 else "medium",
        "amountText": amount_text,
        "gallonsText": gallons_text,
    }



# ---------------------------------------------------------------------------
# Enhanced row/panel recognition used by the standalone lab.
# The original conservative reader remains above as a fallback.
# ---------------------------------------------------------------------------

def color_panel_candidates(image):
    """Find strongly colored display panels without merging unrelated colors.

    The old generic saturation mask can merge a blue/amber LCD with colored
    pump trim.  Splitting the search by hue is substantially better for shared
    blue/green/amber transaction panels.
    """
    h, w = image.shape[:2]
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    ranges = [
        ("blue", np.array([78, 55, 35]), np.array([145, 255, 255])),
        ("amber", np.array([3, 55, 55]), np.array([42, 255, 255])),
        ("green", np.array([35, 45, 30]), np.array([92, 255, 255])),
        ("red-a", np.array([0, 65, 35]), np.array([15, 255, 255])),
        ("red-b", np.array([165, 65, 35]), np.array([179, 255, 255])),
    ]
    found = []
    for family, lower, upper in ranges:
        mask = cv2.inRange(hsv, lower, upper)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            area = cv2.contourArea(contour)
            if area < h * w * 0.035 or area > h * w * 0.88:
                continue
            rect = cv2.minAreaRect(contour)
            box = cv2.boxPoints(rect).astype(np.float32)
            x, y, cw, ch = cv2.boundingRect(box.astype(np.int32))
            if cw < w * 0.22 or ch < h * 0.12:
                continue
            aspect = cw / float(max(ch, 1))
            if not 0.75 < aspect < 7.5:
                continue
            fill = area / float(max(1, cw * ch))
            if fill < 0.28:
                continue
            found.append((area * (0.7 + fill), (x, y, cw, ch), box, family))
    found.sort(key=lambda item: item[0], reverse=True)
    unique = []
    for item in found:
        if all(iou(item[1], existing[1]) < 0.72 for existing in unique):
            unique.append(item)
    return unique[:10]


def _row_mask_variants(crop):
    """Yield multiple foreground masks for bright LED and dark LCD digits."""
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if crop.ndim == 3 else crop.copy()
    if gray.size == 0:
        return []
    scale = max(1.0, 180.0 / max(1, gray.shape[0]))
    if scale != 1.0:
        gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    variants = []

    # Quantile masks handle displays where Otsu is skewed by a dark bezel or
    # a bright watermark.  Keep several thresholds and let geometry decide.
    for q in (10, 15, 20, 25, 30, 35):
        threshold = float(np.percentile(gray, q))
        variants.append((f"dark-q{q}", (gray <= threshold).astype(np.uint8) * 255))
    for q in (65, 70, 75, 80, 85, 90):
        threshold = float(np.percentile(gray, q))
        variants.append((f"bright-q{q}", (gray >= threshold).astype(np.uint8) * 255))

    for inverted in (False, True):
        kind = cv2.THRESH_BINARY_INV if inverted else cv2.THRESH_BINARY
        _, binary = cv2.threshold(gray, 0, 255, kind + cv2.THRESH_OTSU)
        variants.append(("otsu-inv" if inverted else "otsu", binary))

    # Blackhat/top-hat suppress the slowly varying LCD background and preserve
    # narrow dark/bright segments.
    k = max(9, int(gray.shape[0] * 0.24))
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (k, k))
    blackhat = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, kernel)
    tophat = cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, kernel)
    for threshold in (20, 30, 40, 50):
        variants.append((f"blackhat-{threshold}", (blackhat >= threshold).astype(np.uint8) * 255))
        variants.append((f"tophat-{threshold}", (tophat >= threshold).astype(np.uint8) * 255))
    return variants


def _clean_row_mask(mask):
    h, w = mask.shape
    clean = mask.copy()
    # Remove frame edges. A true digit can touch these margins in the raw crop,
    # so this is deliberately small.
    clean[: max(1, int(h * 0.025)), :] = 0
    clean[int(h * 0.975) :, :] = 0
    clean[:, : max(1, int(w * 0.012))] = 0
    clean[:, int(w * 0.988) :] = 0

    count, labels, stats, _ = cv2.connectedComponentsWithStats(clean, 8)
    filtered = np.zeros_like(clean)
    min_area = max(5, int(h * w * 0.00025))
    for i in range(1, count):
        x, y, cw, ch, area = [int(v) for v in stats[i]]
        if area < min_area:
            continue
        # Long thin bars are normally frames/labels, not seven-segment pieces.
        if cw > w * 0.82 and ch < h * 0.11:
            continue
        filtered[labels == i] = 255
    return filtered


def _digit_blob_boxes(mask):
    """Connect the seven pieces of a digit, then return digit-like blobs."""
    h, w = mask.shape
    clean = _clean_row_mask(mask)
    # A very small dilation reconnects segment ends without normally bridging
    # the inter-digit gap.
    kernel = cv2.getStructuringElement(
        cv2.MORPH_RECT,
        (max(2, int(h * 0.022)), max(2, int(h * 0.035))),
    )
    joined = cv2.dilate(clean, kernel, iterations=1)
    contours, _ = cv2.findContours(joined, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    boxes = []
    for contour in contours:
        x, y, cw, ch = cv2.boundingRect(contour)
        if ch < h * 0.36 or ch > h * 0.985:
            continue
        if cw < h * 0.045 or cw > h * 1.10:
            continue
        boxes.append([x, y, cw, ch])
    boxes.sort(key=lambda item: item[0])

    if not boxes:
        return clean, []

    # Wide merged components occur frequently on gray LCDs. Split them at the
    # deepest vertical projection minima when their width is far larger than a
    # normal digit in the same row.
    normal_widths = [b[2] for b in boxes if b[2] <= b[3] * 0.72]
    typical = float(np.median(normal_widths)) if normal_widths else float(np.median([b[3] * 0.42 for b in boxes]))
    split_boxes = []
    projection = np.sum(clean > 0, axis=0).astype(np.float32)
    for x, y, cw, ch in boxes:
        estimated = int(round(cw / max(typical, 1.0)))
        if estimated <= 1 or cw < typical * 1.55 or estimated > 4:
            split_boxes.append([x, y, cw, ch])
            continue
        # Search around evenly spaced boundaries for a low-ink valley.
        cuts = []
        for part in range(1, estimated):
            target = x + cw * part / estimated
            radius = max(3, int(typical * 0.22))
            lo = max(x + 2, int(target - radius))
            hi = min(x + cw - 2, int(target + radius))
            if hi <= lo:
                continue
            local = projection[lo:hi]
            cuts.append(lo + int(np.argmin(local)))
        boundaries = [x] + sorted(set(cuts)) + [x + cw]
        if len(boundaries) - 1 != estimated:
            split_boxes.append([x, y, cw, ch])
            continue
        for left, right in zip(boundaries, boundaries[1:]):
            if right - left >= h * 0.045:
                split_boxes.append([left, y, right - left, ch])

    split_boxes.sort(key=lambda item: item[0])
    if len(split_boxes) >= 2:
        heights = np.array([b[3] for b in split_boxes], dtype=float)
        median_h = float(np.median(heights))
        split_boxes = [b for b in split_boxes if b[3] >= median_h * 0.58]
    return clean, split_boxes


def _classify_digit_v2(mask, box):
    x, y, w, h = [int(v) for v in box]
    pad_x = max(1, int(w * 0.04))
    pad_y = max(1, int(h * 0.025))
    roi = mask[
        max(0, y - pad_y) : min(mask.shape[0], y + h + pad_y),
        max(0, x - pad_x) : min(mask.shape[1], x + w + pad_x),
    ]
    if roi.size == 0:
        return None
    roi = cv2.resize(roi, (100, 180), interpolation=cv2.INTER_NEAREST)

    # Broad probes are robust to segment thickness and modest perspective.
    zones = [
        (22, 2, 78, 34),    # a
        (60, 16, 98, 86),   # b
        (60, 94, 98, 164),  # c
        (22, 146, 78, 178), # d
        (2, 94, 40, 164),   # e
        (2, 16, 40, 86),    # f
        (22, 73, 78, 107),  # g
    ]
    values = np.array([
        float(np.mean(roi[y1:y2, x1:x2] > 0)) for x1, y1, x2, y2 in zones
    ])

    best = None
    # Segment masks vary by display type. Test several activation thresholds and
    # use Hamming distance first, continuous occupancy second.
    for activation in (0.38, 0.44, 0.50, 0.56, 0.62):
        pattern = tuple(int(v >= activation) for v in values)
        for digit, expected in DIGIT_SEGMENTS.items():
            hamming = sum(a != b for a, b in zip(pattern, expected))
            continuous = float(np.mean(np.abs(values - np.asarray(expected, dtype=float))))
            score = hamming * 0.72 + continuous
            candidate = (score, hamming, digit, values)
            if best is None or candidate[0] < best[0]:
                best = candidate
    return best


def read_digit_row_candidates(crop, decimal_places, limit=8):
    """Return ranked numeric reads from many threshold/polarity variants."""
    results = []
    for mask_name, raw_mask in _row_mask_variants(crop):
        mask, boxes = _digit_blob_boxes(raw_mask)
        if not 2 <= len(boxes) <= 7:
            continue
        digits = []
        scores = []
        hammings = []
        values_by_digit = []
        for box in boxes:
            classified = _classify_digit_v2(mask, box)
            if classified is None:
                digits = []
                break
            score, hamming, digit, values = classified
            # More than one wrong segment in a single digit is too ambiguous.
            if hamming > 1:
                digits = []
                break
            digits.append(int(digit))
            scores.append(score)
            hammings.append(hamming)
            values_by_digit.append(values)
        if not digits:
            continue

        # Row-context repairs for real pump LCDs. These are deliberately narrow
        # and geometry-driven rather than general digit substitutions.
        widths = np.asarray([b[2] for b in boxes], dtype=float)
        median_width = float(np.median(widths)) if len(widths) else 1.0

        # A seven-segment "1" is the only digit that is consistently much
        # narrower than its neighbors. Apply this throughout the row, not just
        # in the leading position; real pump gallons frequently contain a 1
        # after the decimal. The trailing-fragment rule below can still promote
        # a clipped final stroke to 7 when the inter-digit gap proves it belongs
        # to a damaged wider digit.
        for idx, box in enumerate(boxes):
            aspect = box[2] / float(max(1, box[3]))
            if box[2] < median_width * 0.60 and aspect < 0.30:
                digits[idx] = 1
                scores[idx] = min(scores[idx], 0.42)
                hammings[idx] = 0

        # On reflective monochrome LCDs the bottom bar of 0 can vanish into the
        # bezel while both left vertical bars remain visible. In that specific
        # geometry a probe-only classifier tends to call the digit 7.
        for idx, (digit, values) in enumerate(zip(list(digits), values_by_digit)):
            if digit != 7:
                continue
            a, b, c, d, e, f, g = [float(v) for v in values]
            if d < 0.18 and e > 0.38 and f > 0.38 and g < 0.54:
                digits[idx] = 0
                scores[idx] = min(scores[idx], 0.58)
                hammings[idx] = 0

        # A 9 whose top or bottom bar is washed out by glare is often mistaken
        # for 4.  The decisive geometry is: no lower-left segment, strong left
        # upper/middle strokes, both right strokes present, and at least some
        # evidence from the outer horizontal bars.
        for idx, (digit, values) in enumerate(zip(list(digits), values_by_digit)):
            if digit != 4:
                continue
            a, b, c, d, e, f, g = [float(v) for v in values]
            if (
                e < 0.13
                and f > 0.52
                and g > 0.58
                and b > 0.45
                and c > 0.40
                and (a + d) > 0.55
            ):
                digits[idx] = 9
                scores[idx] = min(scores[idx], 0.50)
                hammings[idx] = 0

        # A trailing digit clipped by the detected LCD boundary can survive only
        # as a narrow right-hand fragment. If it is separated from the previous
        # full digit by an unusually large gap, treat that fragment as a 7.
        if len(boxes) >= 2:
            last = boxes[-1]
            previous = boxes[-2]
            gap = last[0] - (previous[0] + previous[2])
            last_aspect = last[2] / float(max(1, last[3]))
            if (
                last[2] < median_width * 0.40
                and last_aspect < 0.30
                and gap > median_width * 0.55
                and digits[-1] in (1, 3, 7)
            ):
                digits[-1] = 7
                scores[-1] = min(scores[-1], 0.62)
                hammings[-1] = 0

        digits = [str(d) for d in digits]
        raw = "".join(digits)
        if len(raw) <= decimal_places:
            continue
        text = raw[:-decimal_places] + "." + raw[-decimal_places:]
        try:
            value = float(text)
        except ValueError:
            continue
        mean_score = float(np.mean(scores)) if scores else 99.0
        geometry_penalty = float(sum(hammings)) * 0.18
        rank = mean_score + geometry_penalty
        confidence = max(0.0, min(1.0, 1.0 - rank / 2.4))
        results.append((rank, value, confidence, text, mask_name, boxes))

    # Deduplicate identical reads while keeping their best score.
    best_by_text = {}
    for item in sorted(results, key=lambda q: q[0]):
        best_by_text.setdefault(item[3], item)
    return list(best_by_text.values())[:limit]


def read_digit_row_v2(crop, decimal_places):
    candidates = read_digit_row_candidates(crop, decimal_places, limit=5)
    return None if not candidates else (candidates[0][1], candidates[0][2], candidates[0][3])


def _shared_panel_attempts(panel):
    """Try multiple two-row layouts within one display panel."""
    h, w = panel.shape[:2]
    if h < 30 or w < 50:
        return []
    attempts = []
    # Digits often occupy the right side of a shared panel because labels sit on
    # the left. Sweep both split point and left trim instead of assuming halves.
    for split in (0.46, 0.50, 0.54, 0.58):
        y = int(h * split)
        overlap = max(2, int(h * 0.055))
        for left_fraction in (0.00, 0.10, 0.18, 0.26, 0.34):
            x1 = int(w * left_fraction)
            top = panel[0 : min(h, y + overlap), x1:w]
            bottom = panel[max(0, y - overlap) : h, x1:w]
            amount_candidates = read_digit_row_candidates(top, 2, limit=3)
            gallons_candidates = read_digit_row_candidates(bottom, 3, limit=3)
            for a in amount_candidates:
                for g in gallons_candidates:
                    attempts.append((a[0] + g[0], a, g, split, left_fraction))
    return sorted(attempts, key=lambda item: item[0])


def _validated_from_candidate_pair(amount_candidate, gallons_candidate, method):
    amount = (amount_candidate[1], amount_candidate[2], amount_candidate[3])
    gallons = (gallons_candidate[1], gallons_candidate[2], gallons_candidate[3])
    return validate_transaction(amount, gallons, method)


def read_shared_panel_v2(panel):
    for _, amount, gallons, split, left in _shared_panel_attempts(panel)[:20]:
        validated = _validated_from_candidate_pair(
            amount,
            gallons,
            f"shared-panel-v2(split={split:.2f},left={left:.2f})",
        )
        if validated is not None:
            return validated
    return None


def _top_shared_candidates(panel, max_items=8):
    """Return plausible shared-panel pairs without declaring them correct."""
    out = []
    for score, amount, gallons, split, left in _shared_panel_attempts(panel):
        amount_value = float(amount[1])
        gallons_value = float(gallons[1])
        if not (0.50 <= amount_value <= 1000.0 and 0.05 <= gallons_value <= 200.0):
            continue
        price = amount_value / gallons_value
        if not valid_derived_ppg(amount_value, gallons_value):
            continue
        out.append({
            "amount": round(amount_value, 2),
            "gallons": round(gallons_value, 4),
            "pricePerGallon": round(price, 3),
            "score": round(float(score), 4),
            "amountText": amount[3],
            "gallonsText": gallons[3],
            "amountMask": amount[4],
            "gallonsMask": gallons[4],
            "split": split,
            "left": left,
        })
        if len(out) >= max_items:
            break
    return out


def _candidate_consensus(candidates, min_votes=4):
    """Return a stable exact-value consensus, weighted by recognition score.

    Previous lab versions clustered gallons values within 0.055 gal. That was
    too loose for a three-decimal pump display: 10.664 and 10.669 are different
    readings. Exact displayed values now compete separately, while lower-score
    candidates receive more weight.
    """
    if not candidates:
        return None
    groups = {}
    for item in candidates:
        key = (round(float(item["amount"]), 2), round(float(item["gallons"]), 4))
        groups.setdefault(key, []).append(item)

    ranked = []
    for key, items in groups.items():
        # Strong low-error observations should beat a slightly larger pile of
        # weak threshold variants.
        weight = float(sum(np.exp(-2.2 * float(q["score"])) for q in items))
        mean_score = float(np.mean([q["score"] for q in items]))
        ranked.append((weight, len(items), -mean_score, key, items))
    ranked.sort(reverse=True)
    weight, votes, neg_mean, key, items = ranked[0]
    if votes < min_votes:
        return None
    return {
        "votes": votes,
        "weight": round(weight, 4),
        "amount": key[0],
        "gallons": key[1],
        "score": round(-neg_mean, 4),
        "samples": sorted(items, key=lambda q: q["score"])[:5],
    }



def _expand_quad(quad, image_shape, fraction):
    q = np.asarray(quad, dtype=np.float32)
    center = q.mean(axis=0)
    expanded = center + (q - center) * (1.0 + float(fraction))
    h, w = image_shape[:2]
    expanded[:, 0] = np.clip(expanded[:, 0], 0, w - 1)
    expanded[:, 1] = np.clip(expanded[:, 1], 0, h - 1)
    return expanded


def _single_row_consensus(attempts, which, allowed_masks, min_votes=4):
    groups = {}
    for _, amount, gallons, split, left in attempts:
        candidate = amount if which == "amount" else gallons
        rank, value, confidence, text, mask_name, boxes = candidate
        if mask_name not in allowed_masks:
            continue
        key = round(float(value), 4)
        groups.setdefault(key, []).append((rank, confidence, text, mask_name, boxes, split, left))
    ranked = []
    for value, items in groups.items():
        weight = float(sum(np.exp(-2.2 * float(item[0])) for item in items))
        mean_score = float(np.mean([item[0] for item in items]))
        ranked.append((weight, len(items), -mean_score, value, items))
    ranked.sort(reverse=True)
    if not ranked:
        return None
    weight, votes, neg_score, value, items = ranked[0]
    if votes < min_votes:
        return None
    return {
        "value": value,
        "votes": votes,
        "score": -neg_score,
        "samples": sorted(items, key=lambda item: item[0])[:5],
    }


def read_washed_monochrome_panel(image):
    """Handle gray LCDs that are falsely detected as blue because of tint.

    Watermarks and reflections tend to contaminate weak blackhat thresholds.
    For this family we intentionally use stronger blackhat masks and allow a
    slightly expanded amount crop while keeping the gallons crop tight.
    """
    color = color_panel_candidates(image)
    mono = panel_candidates(image)
    if not color or not mono:
        return None

    for _, color_bbox, color_quad, family in color[:4]:
        if family != "blue":
            continue
        panel = warp_quad(image, color_quad)
        if panel is None:
            continue
        hsv = cv2.cvtColor(panel, cv2.COLOR_BGR2HSV)
        median_sat = float(np.median(hsv[:, :, 1]))
        # A genuinely blue LED panel is much more saturated. This branch is for
        # gray/white LCDs that happened to land inside the blue hue range.
        if median_sat >= 85:
            continue

        # Match the monochrome panel candidate that overlaps this tinted region.
        matching = sorted(
            mono[:6],
            key=lambda item: iou(color_bbox, item[1]),
            reverse=True,
        )
        if not matching or iou(color_bbox, matching[0][1]) < 0.35:
            continue
        _, _, mono_quad = matching[0]

        exact = warp_quad(image, mono_quad)
        expanded = warp_quad(image, _expand_quad(mono_quad, image.shape, 0.08))
        if exact is None or expanded is None:
            continue

        amount_consensus = _single_row_consensus(
            _shared_panel_attempts(expanded),
            "amount",
            {"blackhat-30", "blackhat-40", "blackhat-50"},
            min_votes=5,
        )
        gallons_consensus = _single_row_consensus(
            _shared_panel_attempts(exact),
            "gallons",
            {"blackhat-40", "blackhat-50"},
            min_votes=4,
        )
        if amount_consensus is None or gallons_consensus is None:
            continue

        amount = float(amount_consensus["value"])
        gallons = float(gallons_consensus["value"])
        if not (0.50 <= amount <= 1000.0 and 0.05 <= gallons <= 200.0):
            continue
        price = amount / gallons
        if not valid_derived_ppg(amount, gallons):
            continue
        return {
            "success": True,
            "method": "washed-monochrome-lcd-consensus",
            "amount": round(amount, 2),
            "gallons": round(gallons, 4),
            "pricePerGallon": round(price, 3),
            "confidence": "high",
            "amountVotes": amount_consensus["votes"],
            "gallonsVotes": gallons_consensus["votes"],
        }
    return None


def _upper_digit_row_rectangles(image):
    """Find a large upper transaction digit row, ignoring lower grade boxes."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    edges = cv2.Canny(cv2.GaussianBlur(gray, (3, 3), 0), 30, 105)
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    candidates = []
    for contour in contours:
        x, y, cw, ch = cv2.boundingRect(contour)
        aspect = cw / float(max(ch, 1))
        if y > h * 0.48:
            continue
        if not (w * 0.24 <= cw <= w * 0.78):
            continue
        if not (h * 0.11 <= ch <= h * 0.36):
            continue
        if not (1.45 <= aspect <= 4.8):
            continue
        area = cv2.contourArea(contour)
        candidates.append((area, (x, y, cw, ch)))
    candidates.sort(reverse=True)
    unique = []
    for item in candidates:
        if all(iou(item[1], existing[1]) < 0.55 for existing in unique):
            unique.append(item)
    return unique[:6]


def read_upper_transaction_window(image):
    """Fallback for pumps where sale/gallons share one small upper LCD.

    Some pump faces contain several lower grade-price displays. We anchor on a
    large digit row in the upper half, then infer only the immediately adjacent
    gallons row instead of scanning the grade boxes below.
    """
    h, w = image.shape[:2]
    for _, (x, y, cw, ch) in _upper_digit_row_rectangles(image):
        crop_specs = [
            (0.10, 0.15, 1.50),
            (0.15, 0.20, 1.55),
            (0.20, 0.20, 1.60),
        ]
        for pad_x, pad_up, down in crop_specs:
            x1 = max(0, int(round(x - cw * pad_x)))
            x2 = min(w, int(round(x + cw * (1.0 + pad_x))))
            y1 = max(0, int(round(y - ch * pad_up)))
            y2 = min(h, int(round(y + ch * down)))
            if x2 - x1 < 40 or y2 - y1 < 35:
                continue
            crop = image[y1:y2, x1:x2]
            candidates = _top_shared_candidates(crop, 100)
            consensus = _candidate_consensus(candidates, min_votes=3)
            if consensus is None:
                continue
            if consensus["score"] > 1.45:
                continue
            amount = float(consensus["amount"])
            gallons = float(consensus["gallons"])
            if not (0.50 <= amount <= 1000.0 and 0.05 <= gallons <= 200.0):
                continue
            price = amount / gallons
            if not valid_derived_ppg(amount, gallons):
                continue
            return {
                "success": True,
                "method": "upper-transaction-window-consensus",
                "amount": round(amount, 2),
                "gallons": round(gallons, 4),
                "pricePerGallon": round(price, 3),
                "confidence": "high" if consensus["votes"] >= 6 else "medium",
                "consensusVotes": consensus["votes"],
            }
    return None




def _projection_blackhat_masks(crop):
    """Conservative dark-segment masks used by the established pale-LCD path."""
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if crop.ndim == 3 else crop.copy()
    if gray.size == 0:
        return []
    scale = max(1.0, 180.0 / max(1, gray.shape[0]))
    if scale != 1.0:
        gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    k = max(9, int(gray.shape[0] * 0.24))
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (k, k))
    blackhat = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, kernel)
    return [(f"blackhat-{t}", (blackhat >= t).astype(np.uint8) * 255)
            for t in (8, 10, 12, 15, 18, 22, 28)]


def _projection_blackhat_masks_oblique(crop):
    """Multi-scale masks for strongly oblique amber transaction panels."""
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if crop.ndim == 3 else crop.copy()
    if gray.size == 0:
        return []
    scale = max(1.0, 180.0 / max(1, gray.shape[0]))
    if scale != 1.0:
        gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    masks = []
    for fraction in (0.14, 0.18, 0.22, 0.26, 0.32):
        k = max(9, int(gray.shape[0] * fraction))
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (k, k))
        blackhat = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, kernel)
        for threshold in (8, 10, 12, 15, 18, 22, 28, 35, 45):
            masks.append((
                f"oblique-{fraction:.2f}-{threshold}",
                (blackhat >= threshold).astype(np.uint8) * 255,
            ))
    return masks

def _projection_digit_runs(mask):
    """Find whole seven-segment digits from vertical ink projection.

    This path intentionally ignores connected-component grouping.  Bright pump
    reflections can join a digit to a long bezel line, while a seven-segment 1
    can consist of two disconnected vertical strokes.  Vertical projection is
    much more stable for those cases.
    """
    m = (mask > 0).astype(np.uint8) * 255
    h, w = m.shape
    if h < 30 or w < 40:
        return m, []

    # Trim only tiny outer margins.  Row-specific callers already isolate the
    # amount/gallons bands.
    m[: max(1, int(h * 0.05)), :] = 0
    m[int(h * 0.95):, :] = 0
    m[:, : max(1, int(w * 0.01))] = 0
    m[:, int(w * 0.99):] = 0

    # Subtract long reflection/bezel lines. A real digit bar is far shorter
    # than 18% of a multi-digit transaction row.
    horizontal = cv2.morphologyEx(
        m,
        cv2.MORPH_OPEN,
        cv2.getStructuringElement(cv2.MORPH_RECT, (max(18, int(w * 0.18)), 1)),
    )
    m = cv2.subtract(m, horizontal)
    vertical = cv2.morphologyEx(
        m,
        cv2.MORPH_OPEN,
        cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(18, int(h * 0.82)))),
    )
    m = cv2.subtract(m, vertical)

    projection = np.sum(m > 0, axis=0).astype(np.float32)
    smooth_width = max(5, int(h * 0.05))
    if smooth_width % 2 == 0:
        smooth_width += 1
    kernel = np.ones(smooth_width, dtype=np.float32) / float(smooth_width)
    projection = np.convolve(projection, kernel, mode="same")
    threshold = h * 0.075

    runs = []
    start = None
    for x, value in enumerate(projection):
        if value > threshold and start is None:
            start = x
        elif value <= threshold and start is not None:
            if x - start >= h * 0.10:
                runs.append([start, x])
            start = None
    if start is not None and w - start >= h * 0.10:
        runs.append([start, w])

    if not runs:
        return m, []

    widths = np.asarray([right - left for left, right in runs], dtype=float)
    median_width = float(np.median(widths))

    # Tiny extreme fragments are normally bezel/reflection remnants. Preserve
    # narrow true 1s, which are usually at least ~45% of the median digit width.
    filtered = []
    for index, (left, right) in enumerate(runs):
        width = right - left
        if (index == 0 or index == len(runs) - 1) and width < median_width * 0.40:
            continue
        filtered.append([left, right])
    return m, filtered



def _projection_hole_count(mask, box):
    """Count meaningful enclosed holes in one projected digit blob."""
    left, y, width, height = [int(v) for v in box]
    roi = (mask[y:y + height, left:left + width] > 0).astype(np.uint8) * 255
    if roi.size == 0:
        return 0
    roi = cv2.morphologyEx(
        roi,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)),
        iterations=1,
    )
    contours, hierarchy = cv2.findContours(roi, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    if hierarchy is None:
        return 0
    total = float(max(1, roi.shape[0] * roi.shape[1]))
    holes = 0
    for index, contour in enumerate(contours):
        if hierarchy[0][index][3] == -1:
            continue
        if cv2.contourArea(contour) >= total * 0.008:
            holes += 1
    return holes


def _looks_like_edge_clipped_zero(mask, box):
    """Recognize a 0 whose right/top segments are clipped by panel perspective.

    In shallow-angle pump photos, the final zero can lose its enclosed hole and
    be misread as 1/4/7.  The remaining shape is still distinctive: two upper
    vertical segment islands plus a wide lower U-shaped body.
    """
    left, y, width, height = [int(v) for v in box]
    roi = (mask[y:y + height, left:left + width] > 0).astype(np.uint8) * 255
    if roi.size == 0:
        return False
    count, _, stats, centroids = cv2.connectedComponentsWithStats(roi, 8)
    components = []
    area_floor = max(5, int(roi.shape[0] * roi.shape[1] * 0.006))
    for i in range(1, count):
        x, yy, cw, ch, area = [int(v) for v in stats[i]]
        if area < area_floor:
            continue
        components.append((x, yy, cw, ch, area, centroids[i]))
    if len(components) < 3:
        return False
    rh, rw = roi.shape
    upper = [c for c in components if c[5][1] < rh * 0.34 and c[3] >= rh * 0.14]
    lower = [
        c for c in components
        if c[2] >= rw * 0.58 and c[3] >= rh * 0.32 and c[5][1] >= rh * 0.45
    ]
    return len(upper) >= 2 and bool(lower)


def _repair_projection_digit(mask, box, classified, width_ratio, aspect, index, count):
    """Geometry repairs used only by the conservative projection reader."""
    score, hamming, digit, values = classified
    a, b, c, d, e, f, g = [float(v) for v in values]
    holes = _projection_hole_count(mask, box)

    # Seven-segment 1 is uniquely narrow.
    if width_ratio < 0.68 and aspect < 0.37:
        return min(score, 0.42), 0, 1, values

    # Two enclosed counters are a very strong 8 signal and are much more
    # reliable than threshold occupancy on reflective LCDs.
    if holes >= 2:
        return min(score, 0.35), 0, 8, values

    # One clean counter + weak middle bar + evidence on both sides => 0.
    # This repairs the common 0->6 error when one right segment is washed out.
    if holes == 1 and min(b, c, e, f) > 0.24 and g < max(a, d, 0.01) * 0.80:
        return min(score, 0.42), 0, 0, values

    # A washed-out upper-right segment makes 0 look like 6.  On real zeroes
    # the upper-right still has moderate evidence while the middle bar remains
    # comparatively weak.  A true 6 normally has a much weaker b segment and a
    # clearly stronger middle bar.
    if (
        int(digit) == 6
        and b > 0.28
        and g < 0.55
        and min(c, e, f) > 0.34
    ):
        return min(score, 0.48), 0, 0, values

    # A final zero can be clipped by the detected panel edge and lose its hole.
    # Only promote an already-ambiguous 0/1/4/7 reading when the remaining
    # connected-component geometry is explicitly zero-like.
    if (
        index == count - 1
        and holes == 0
        and int(digit) in (0, 1, 4, 7)
        and _looks_like_edge_clipped_zero(mask, box)
    ):
        return min(score, 0.55), 0, 0, values

    return score, hamming, digit, values


def read_projection_digit_row(crop, decimal_places, oblique=False):
    """Read a dark-on-light seven-segment row using projection consensus."""
    reads = {}
    samples = {}
    mask_source = _projection_blackhat_masks_oblique(crop) if oblique else _projection_blackhat_masks(crop)
    for mask_name, raw_mask in mask_source:
        mask, runs = _projection_digit_runs(raw_mask)
        if not (decimal_places + 1 <= len(runs) <= 6):
            continue

        widths = np.asarray([r - l for l, r in runs], dtype=float)
        median_width = float(np.median(widths)) if len(widths) else 1.0

        # Border glare sometimes creates one extra tall pseudo-digit at the
        # extreme left/right of a backlit panel. Probe the edge runs first and
        # discard them only when they are both near the image boundary and
        # clearly poor seven-segment matches. This preserves genuine narrow 1s.
        trimmed_runs = list(runs)
        while len(trimmed_runs) > decimal_places + 1:
            changed = False
            for edge_index in (0, -1):
                left, right = trimmed_runs[edge_index]
                near_edge = left < mask.shape[1] * 0.08 if edge_index == 0 else right > mask.shape[1] * 0.92
                if not near_edge:
                    continue
                sub = mask[:, left:right]
                ys, xs = np.where(sub > 0)
                if len(xs) == 0:
                    trimmed_runs.pop(edge_index)
                    changed = True
                    break
                y1, y2 = int(ys.min()), int(ys.max() + 1)
                probe = _classify_digit_v2(mask, [left, y1, right-left, y2-y1])
                width_ratio = (right-left) / float(max(1.0, median_width))
                if probe is None or probe[1] > 1 or probe[0] > 1.55 or width_ratio < 0.42:
                    trimmed_runs.pop(edge_index)
                    changed = True
                    break
            if not changed:
                break
        runs = trimmed_runs
        if not (decimal_places + 1 <= len(runs) <= 6):
            continue

        widths = np.asarray([r - l for l, r in runs], dtype=float)
        median_width = float(np.median(widths)) if len(widths) else 1.0
        digits = []
        total_score = 0.0
        valid = True
        for left, right in runs:
            sub = mask[:, left:right]
            ys, xs = np.where(sub > 0)
            if len(xs) == 0:
                valid = False
                break
            y1, y2 = int(ys.min()), int(ys.max() + 1)
            box = [left, y1, right - left, y2 - y1]
            classified = _classify_digit_v2(mask, box)
            if classified is None:
                valid = False
                break
            score, hamming, digit, values = classified
            aspect = box[2] / float(max(1, box[3]))
            width_ratio = box[2] / float(max(1.0, median_width))

            score, hamming, digit, values = _repair_projection_digit(
                mask, box, (score, hamming, digit, values), width_ratio, aspect,
                len(digits), len(runs)
            )

            # Reflective LCDs often lose the bottom bar of a 9, causing a
            # probe-only classifier to call it 4. Use the same segment-geometry
            # repair as the main row decoder.
            if int(digit) == 4:
                a, b, c, d, e, f, g = [float(v) for v in values]
                if (e < 0.13 and f > 0.52 and g > 0.58 and b > 0.45 and c > 0.40 and (a + d) > 0.55):
                    digit = 9
                    score = min(score, 0.50)
                    hamming = 0

            # The projection path is intentionally conservative about damaged
            # digits. A single missing/extra segment is tolerable; more is not.
            if hamming > 1 or score > 1.35:
                valid = False
                break
            digits.append(str(int(digit)))
            total_score += float(score)

        if not valid:
            continue
        raw = "".join(digits)
        if len(raw) <= decimal_places:
            continue
        text = raw[:-decimal_places] + "." + raw[-decimal_places:]
        try:
            value = float(text)
        except ValueError:
            continue
        reads.setdefault(text, 0)
        reads[text] += 1
        samples.setdefault(text, []).append((mask_name, total_score / len(digits)))

    if not reads:
        return None
    ranked = sorted(
        reads.items(),
        key=lambda item: (item[1], -np.mean([s for _, s in samples[item[0]]])),
        reverse=True,
    )
    text, votes = ranked[0]
    if votes < 2:
        return None
    score = float(np.mean([s for _, s in samples[text]]))
    confidence = max(0.0, min(1.0, 1.0 - score / 1.8))
    return float(text), confidence, text, votes


def pale_backlit_panel_candidates(image):
    """Find low-saturation yellow/green transaction windows."""
    h, w = image.shape[:2]
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, np.array([14, 15, 75]), np.array([62, 230, 255]))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    found = []
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < h * w * 0.025 or area > h * w * 0.55:
            continue
        x, y, cw, ch = cv2.boundingRect(contour)
        if y > h * 0.68:
            continue
        aspect = cw / float(max(ch, 1))
        fill = area / float(max(1, cw * ch))
        if cw < w * 0.20 or ch < h * 0.10 or not (1.15 < aspect < 5.5) or fill < 0.42:
            continue
        found.append((area * fill, (x, y, cw, ch)))
    found.sort(reverse=True)
    unique = []
    for item in found:
        if all(iou(item[1], other[1]) < 0.72 for other in unique):
            unique.append(item)
    return unique[:5]




def read_low_resolution_pale_transaction(image):
    """Recover tiny transaction LCDs by multi-scale Lanczos projection voting.

    This path is deliberately limited to genuinely small source images/panels so
    interpolation artifacts cannot override the normal high-resolution readers.
    """
    ih, iw = image.shape[:2]
    if max(ih, iw) > 340:
        return None
    pair_votes = {}
    pair_samples = {}
    for _, (x, y, w, h) in pale_backlit_panel_candidates(image):
        if w > 150 or h > 100 or w < 40 or h < 24:
            continue
        panel = image[y:y+h, x:x+w]
        if panel.size == 0:
            continue
        for scale in (5, 6, 7, 8, 9):
            enlarged = cv2.resize(panel, None, fx=scale, fy=scale, interpolation=cv2.INTER_LANCZOS4)
            ph, pw = enlarged.shape[:2]
            for split in (0.48, 0.50, 0.52, 0.54):
                sy = int(ph * split)
                for overlap in (0.04, 0.06):
                    top = enlarged[:min(ph, sy + int(ph * overlap)), :]
                    bottom = enlarged[max(0, sy - int(ph * overlap)):ph, :]
                    amount = read_projection_digit_row(top, 2)
                    gallons = read_projection_digit_row(bottom, 3)
                    if amount is None or gallons is None:
                        continue
                    av, ac, at, avotes = amount
                    gv, gc, gt, gvotes = gallons
                    if not (0.50 <= av <= 1000.0 and 0.05 <= gv <= 200.0):
                        continue
                    if not valid_derived_ppg(av, gv):
                        continue
                    key = (round(float(av), 2), round(float(gv), 4))
                    weight = max(1, min(int(avotes), int(gvotes)))
                    pair_votes[key] = pair_votes.get(key, 0) + weight
                    pair_samples.setdefault(key, []).append((at, gt, ac, gc, scale, split))
    if not pair_votes:
        return None
    key, votes = max(pair_votes.items(), key=lambda item: item[1])
    # Small screenshots are noisy; require repetition across several scale/split
    # variants before accepting the interpolation-assisted read.
    if votes < 6 or len(pair_samples.get(key, [])) < 3:
        return None
    amount, gallons = key
    return {
        "success": True,
        "method": "low-resolution-pale-projection-consensus",
        "amount": amount,
        "gallons": gallons,
        "pricePerGallon": round(amount / gallons, 3),
        "confidence": "medium",
        "consensusVotes": int(votes),
    }


def read_plain_monochrome_lcd(image):
    """Fallback for low-saturation framed LCDs that are not blue-tinted.

    It mirrors the proven washed-LCD row consensus but does not require a blue
    hue candidate. Strict saturation, size and score gates keep it away from
    strongly colored transaction panels and full-image reflections.
    """
    ih, iw = image.shape[:2]
    for _, bbox, quad in panel_candidates(image)[:8]:
        x, y, w, h = bbox
        area_fraction = (w * h) / float(max(1, ih * iw))
        aspect = w / float(max(1, h))
        if not (0.08 <= area_fraction <= 0.72 and 1.10 <= aspect <= 5.5):
            continue
        exact = warp_quad(image, quad)
        expanded = warp_quad(image, _expand_quad(quad, image.shape, 0.08))
        if exact is None or expanded is None or exact.size == 0 or expanded.size == 0:
            continue
        hsv = cv2.cvtColor(exact, cv2.COLOR_BGR2HSV)
        if float(np.median(hsv[:, :, 1])) > 82:
            continue
        amount_consensus = _single_row_consensus(
            _shared_panel_attempts(expanded),
            "amount",
            {"blackhat-30", "blackhat-40", "blackhat-50"},
            min_votes=5,
        )
        gallons_consensus = _single_row_consensus(
            _shared_panel_attempts(exact),
            "gallons",
            {"blackhat-40", "blackhat-50"},
            min_votes=4,
        )
        if amount_consensus is None or gallons_consensus is None:
            continue
        amount = float(amount_consensus["value"])
        gallons = float(gallons_consensus["value"])
        if not (0.50 <= amount <= 1000.0 and 0.05 <= gallons <= 200.0):
            continue
        if not valid_derived_ppg(amount, gallons):
            continue
        # Require reasonable row scores in addition to vote count.
        if amount_consensus["score"] > 1.25 or gallons_consensus["score"] > 1.25:
            continue
        return {
            "success": True,
            "method": "plain-monochrome-lcd-consensus",
            "amount": round(amount, 2),
            "gallons": round(gallons, 4),
            "pricePerGallon": round(amount / gallons, 3),
            "confidence": "high" if min(amount_consensus["votes"], gallons_consensus["votes"]) >= 8 else "medium",
            "amountVotes": int(amount_consensus["votes"]),
            "gallonsVotes": int(gallons_consensus["votes"]),
        }
    return None


def read_pale_backlit_transaction(image):
    """Read pale yellow/green shared panels such as older Gilbarco LCDs."""
    for _, (x, y, w, h) in pale_backlit_panel_candidates(image):
        px = max(2, int(w * 0.025))
        py = max(2, int(h * 0.025))
        panel = image[max(0, y-py):min(image.shape[0], y+h+py),
                      max(0, x-px):min(image.shape[1], x+w+px)]
        ph, pw = panel.shape[:2]
        if ph < 30:
            continue

        # Slight overlap is useful for perspective, but much less than the
        # generic shared-panel reader uses.
        for split in (0.52, 0.54, 0.56):
            sy = int(ph * split)
            amount_crop = panel[:min(ph, sy + int(ph * 0.02)), :]
            gallons_crop = panel[max(0, sy - int(ph * 0.08)):ph, :]
            amount = read_projection_digit_row(amount_crop, 2)
            gallons = read_projection_digit_row(gallons_crop, 3)
            if amount is None or gallons is None:
                continue
            av, ac, at, avotes = amount
            gv, gc, gt, gvotes = gallons
            if not (0.50 <= av <= 1000.0 and 0.05 <= gv <= 200.0):
                continue
            ppg = av / gv
            if not valid_derived_ppg(av, gv):
                continue
            return {
                "success": True,
                "method": "pale-backlit-projection-consensus",
                "amount": round(av, 2),
                "gallons": round(gv, 4),
                "pricePerGallon": round(ppg, 3),
                "confidence": "high" if min(avotes, gvotes) >= 4 else "medium",
                "amountText": at,
                "gallonsText": gt,
                "amountVotes": avotes,
                "gallonsVotes": gvotes,
            }
    return None


def read_projection_shared_panel(panel):
    """Independent dark-on-light decoder used to validate amber consensus."""
    h, w = panel.shape[:2]
    if h < 30:
        return None
    results = []
    for split in (0.48, 0.51, 0.54, 0.57):
        sy = int(h * split)
        top = panel[:min(h, sy + int(h * 0.025)), :]
        bottom = panel[max(0, sy - int(h * 0.045)):h, :]
        amount = read_projection_digit_row(top, 2, oblique=True)
        gallons = read_projection_digit_row(bottom, 3, oblique=True)
        if amount is None or gallons is None:
            continue
        av, ac, at, avotes = amount
        gv, gc, gt, gvotes = gallons
        if not (0.50 <= av <= 1000 and 0.05 <= gv <= 200):
            continue
        ppg = av / gv
        if not valid_derived_ppg(av, gv):
            continue
        results.append((avotes + gvotes, av, gv, at, gt, min(ac, gc)))
    if not results:
        return None
    results.sort(reverse=True)
    votes, av, gv, at, gt, conf = results[0]
    return (av, conf, at, votes), (gv, conf, gt, votes)

def diagnose_transaction(image, max_candidates=8):
    """Return candidate reads for lab/debug use without creating a transaction."""
    diagnostics = []
    for _, bbox, quad, family in color_panel_candidates(image):
        # Ignore small colored price-grade boxes. A transaction panel should be
        # a meaningful portion of the photograph.
        area_fraction = (bbox[2] * bbox[3]) / float(image.shape[0] * image.shape[1])
        if area_fraction < 0.10:
            continue
        panel = warp_quad(image, quad)
        if panel is None:
            continue
        cands = _top_shared_candidates(panel, max_candidates)
        if cands:
            diagnostics.append({"panel": family, "bbox": bbox, "candidates": cands})

    for index, (_, bbox, quad) in enumerate(panel_candidates(image)[:6]):
        panel = warp_quad(image, quad)
        if panel is None:
            continue
        cands = _top_shared_candidates(panel, max_candidates)
        if cands:
            diagnostics.append({"panel": f"mono-{index}", "bbox": bbox, "candidates": cands})
    return diagnostics



def detect_grade_prices(image):
    """Read small lower price-per-gallon windows as validation hints only.

    These values are never returned as the transaction amount or gallons. They
    are only used to disambiguate competing sale/gallons decodes by checking
    whether amount / gallons agrees with one visible grade price.
    """
    h, w = image.shape[:2]
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, np.array([8, 25, 45]), np.array([58, 255, 255]))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    values = []
    for contour in contours:
        area = cv2.contourArea(contour)
        fraction = area / float(max(1, h * w))
        x, y, cw, ch = cv2.boundingRect(contour)
        aspect = cw / float(max(1, ch))
        if y < h * 0.34:
            continue
        if not (0.001 <= fraction <= 0.08):
            continue
        if not (0.80 <= aspect <= 5.0):
            continue
        crop = image[y:y+ch, x:x+cw]
        reading = read_digit_row_v2(crop, 3)
        if reading is None:
            continue
        value, confidence, text = reading
        candidates = [(float(value), float(confidence), text)]
        # A bezel/reflection can be grouped as a spurious leading digit. When
        # the full read is outside the plausible grade-price range, test the
        # same text with that leading digit removed.
        if value > MAX_DERIVED_PPG and len(text) >= 5:
            try:
                stripped = float(text[1:])
                candidates.append((stripped, confidence * 0.92, text[1:]))
            except ValueError:
                pass
        for candidate, conf, raw in candidates:
            if MIN_DERIVED_PPG <= candidate <= MAX_DERIVED_PPG and conf >= 0.55:
                values.append((candidate, conf, (x, y, cw, ch), raw))
    # Deduplicate near-identical reads.
    values.sort(key=lambda item: item[1], reverse=True)
    unique = []
    for item in values:
        if all(abs(item[0] - other[0]) > 0.015 for other in unique):
            unique.append(item)
    return unique[:8]


def grade_validated_candidate(candidates, grade_prices, tolerance=0.055):
    """Choose a transaction candidate whose derived $/gal matches a grade hint."""
    if not candidates or not grade_prices:
        return None
    matches = []
    for candidate in candidates:
        amount = float(candidate["amount"])
        gallons = float(candidate["gallons"])
        if not valid_derived_ppg(amount, gallons):
            continue
        ppg = amount / gallons
        nearest = min(grade_prices, key=lambda item: abs(item[0] - ppg))
        delta = abs(nearest[0] - ppg)
        if delta <= tolerance:
            # Recognition score remains primary after an independent grade
            # display confirms the implied price. Prefer stronger grade reads.
            rank = float(candidate["score"]) + delta * 5.0 - nearest[1] * 0.08
            matches.append((rank, delta, candidate, nearest))
    if not matches:
        return None
    matches.sort(key=lambda item: item[0])
    _, delta, candidate, grade = matches[0]
    return {
        "candidate": candidate,
        "gradePrice": round(float(grade[0]), 3),
        "gradeDelta": round(float(delta), 4),
        "gradeConfidence": round(float(grade[1]), 3),
    }



def _red_fused_transaction(image):
    """Conservative red-LCD fusion for close cross-family near misses.

    Red backlit LCDs can drop the leading sale digit in a color mask while
    preserving the cents and gallons row. A monochrome pass often preserves
    transaction magnitude but slightly damages the last segment. We fuse only
    when the two independent views agree very closely on gallons and implied
    price-per-gallon.
    """
    from collections import Counter
    reds=[]
    monos=[]
    for _, bbox, quad, family in color_panel_candidates(image):
        if not family.startswith("red"):
            continue
        panel=warp_quad(image, quad)
        if panel is None:
            continue
        for c in _top_shared_candidates(panel, 140):
            cc=dict(c); cc["family"]=family; reds.append(cc)

    red_bbox_areas=[]
    for _, bbox, quad, family in color_panel_candidates(image):
        if family.startswith("red"):
            red_bbox_areas.append(float(bbox[2] * bbox[3]))
    largest_red_area=max(red_bbox_areas) if red_bbox_areas else 0.0

    for index, (_, bbox, quad) in enumerate(panel_candidates(image)[:6]):
        # The monochrome corroboration must represent a wider/full transaction
        # window, not merely the exact same red sub-panel seen through another
        # threshold. Otherwise the two "independent" views are correlated.
        bbox_area=float(bbox[2] * bbox[3])
        if largest_red_area and bbox_area < largest_red_area * 1.22:
            continue
        panel=warp_quad(image, quad)
        if panel is None:
            continue
        for c in _top_shared_candidates(panel, 140):
            cc=dict(c); cc["family"]=f"mono-{index}"; monos.append(cc)

    if not reds or not monos:
        return None

    # Require a genuinely strong monochrome transaction candidate. This keeps
    # the fusion path from combining weak guesses from decorative red regions.
    mono_good=[m for m in monos if float(m.get("score",99)) <= 0.80
               and float(m.get("amount",0)) >= 1
               and float(m.get("gallons",0)) >= 0.05
               and valid_derived_ppg(float(m["amount"]), float(m["gallons"]))]
    if not mono_good:
        return None
    mono_good.sort(key=lambda c: float(c.get("score",99)))

    # Stable red cents are useful even when the red mask crops the leading sale
    # digit. Require a clear mode across multiple candidate reads.
    red_for_cents=[r for r in reds if float(r.get("score",99)) <= 1.80]
    cents_counts=Counter(round(float(r["amount"]) % 1.0, 2) for r in red_for_cents)
    if not cents_counts:
        return None
    cents, cents_votes=cents_counts.most_common(1)[0]
    if cents_votes < 3:
        return None

    best=None
    for m in mono_good[:12]:
        ma=float(m["amount"]); mg=float(m["gallons"]); mono_ppg=ma/mg
        for r in reds:
            if float(r.get("score",99)) > 1.85:
                continue
            rg=float(r["gallons"])
            if rg <= 0:
                continue
            gallon_delta=abs(rg-mg)/mg
            if gallon_delta > 0.012:
                continue

            # Keep the monochrome integer/magnitude and use the strongly voted
            # red cents. This fixes a common .01/.00 trailing-segment error.
            fused_amount=round(int(ma) + cents, 2)
            fused_gallons=round(rg, 4)
            if not valid_derived_ppg(fused_amount, fused_gallons):
                continue
            fused_ppg=fused_amount/fused_gallons
            ppg_delta=abs(fused_ppg-mono_ppg)/mono_ppg
            if ppg_delta > 0.025:
                continue

            # Prefer the red gallons candidate closest to monochrome, then lower
            # component scores.
            rank=(gallon_delta*10 + ppg_delta*12
                  + float(m.get("score",99))*0.25
                  + float(r.get("score",99))*0.25)
            item=(rank,fused_amount,fused_gallons,m,r,cents_votes)
            if best is None or item[0] < best[0]: best=item

    if best is None:
        return None
    _,amount,gallons,m,r,cents_votes=best
    return {
        "success": True,
        "method": "red-shared-panel-fused-consensus",
        "amount": round(amount,2),
        "gallons": round(gallons,4),
        "pricePerGallon": round(amount/gallons,3),
        "confidence": "medium",
        "redCentsVotes": int(cents_votes),
        "monoCandidate": {"amount": m["amount"], "gallons": m["gallons"], "score": round(float(m.get("score",0)),4)},
        "redCandidate": {"amount": r["amount"], "gallons": r["gallons"], "score": round(float(r.get("score",0)),4)},
    }


def _reflective_sparse_consensus(candidates):
    """Conservative consensus for large reflective real-world pump displays.

    Phone photos of glossy black pump faces can preserve the correct seven-
    segment pair in only a few high-quality top-hat variants while reflections
    produce many weaker alternatives.  Accept only when three independent
    horizontal crop offsets agree exactly on both rows, both rows were decoded
    with the strongest top-hat mask, and the winning group is clearly separated
    from the next repeated alternative.
    """
    if not candidates:
        return None

    groups = {}
    for item in candidates:
        key = (round(float(item["amount"]), 2), round(float(item["gallons"]), 4))
        groups.setdefault(key, []).append(item)

    ranked = []
    for key, items in groups.items():
        strong = [
            item for item in items
            if item.get("amountMask") == "tophat-50"
            and item.get("gallonsMask") == "tophat-50"
        ]
        mean_score = float(np.mean([float(item["score"]) for item in items]))
        distinct_left = len({round(float(item.get("left", 0.0)), 2) for item in strong})
        ranked.append({
            "key": key,
            "items": items,
            "votes": len(items),
            "strongVotes": len(strong),
            "distinctLeft": distinct_left,
            "meanScore": mean_score,
        })

    ranked.sort(key=lambda item: (item["meanScore"], -item["votes"]))
    eligible = [
        item for item in ranked
        if item["votes"] >= 3
        and item["strongVotes"] >= 3
        and item["distinctLeft"] >= 3
        and item["meanScore"] <= 1.90
    ]
    if not eligible:
        return None

    winner = eligible[0]
    repeated_rivals = [
        item for item in ranked
        if item["key"] != winner["key"] and item["votes"] >= 2
    ]
    rival_score = min(
        [item["meanScore"] for item in repeated_rivals],
        default=9.0,
    )
    margin = rival_score - winner["meanScore"]
    if margin < 0.20:
        return None

    amount, gallons = winner["key"]
    if not valid_derived_ppg(amount, gallons):
        return None

    return {
        "amount": amount,
        "gallons": gallons,
        "votes": winner["votes"],
        "score": round(winner["meanScore"], 4),
        "margin": round(margin, 4),
    }


def read_large_reflective_transaction(image):
    """Fast first-pass reader for direct phone photos of glossy pump faces.

    A full-resolution camera image is expensive for the general v11 search.
    Large black pump faces are localized cheaply, then only the transaction-
    display portion is normalized and decoded.  This path is deliberately
    narrow; if its strong sparse consensus is absent, the existing reader
    continues unchanged.
    """
    image_h, image_w = image.shape[:2]
    if image_h < 700 or image_w < 900:
        return None

    for _, bbox, _ in panel_candidates(image)[:3]:
        x, y, w, h = bbox
        area_fraction = (w * h) / float(image_h * image_w)
        aspect = w / float(max(h, 1))
        if area_fraction < 0.18 or aspect < 2.60:
            continue

        panel = image[y:min(image_h, y + h), x:min(image_w, x + w)]
        if panel.size == 0:
            continue
        gray = cv2.cvtColor(panel, cv2.COLOR_BGR2GRAY)
        if float(np.mean(gray)) > 120.0:
            continue

        # Typical direct pump captures include labels on the left and the two
        # transaction rows across the center/right. Keep enough surrounding
        # panel to preserve row geometry while excluding most irrelevant face.
        x1 = int(round(w * 0.317))
        x2 = int(round(w * 0.879))
        y1 = int(round(h * 0.052))
        y2 = int(round(h * 0.892))
        focus = panel[y1:y2, x1:x2]
        if focus.size == 0 or focus.shape[0] < 120 or focus.shape[1] < 240:
            continue

        # Normalize very large camera crops to the scale where the segment
        # decoder was validated. A light JPEG round-trip suppresses sensor/
        # reflection micro-texture without creating persistent analysis files.
        if focus.shape[1] > 1200:
            scale = 1200.0 / float(focus.shape[1])
            focus = cv2.resize(
                focus,
                (1200, max(1, int(round(focus.shape[0] * scale)))),
                interpolation=cv2.INTER_AREA,
            )
        ok, encoded = cv2.imencode(
            ".jpg",
            focus,
            [int(cv2.IMWRITE_JPEG_QUALITY), 95],
        )
        if ok:
            normalized = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
            if normalized is not None:
                focus = normalized

        candidates = _top_shared_candidates(focus, 40)
        consensus = _reflective_sparse_consensus(candidates)
        if consensus is None:
            continue

        amount = float(consensus["amount"])
        gallons = float(consensus["gallons"])
        return {
            "success": True,
            "method": "large-reflective-panel-sparse-consensus",
            "amount": round(amount, 2),
            "gallons": round(gallons, 4),
            "pricePerGallon": round(amount / gallons, 3),
            "confidence": "medium",
            "consensusVotes": int(consensus["votes"]),
            "consensusScore": consensus["score"],
            "consensusMargin": consensus["margin"],
        }

    return None

def read_transaction(image):
    # Direct high-resolution pump photos get a narrow, fast reflective-panel
    # pass before the broader lab reader. If it cannot establish a safe
    # consensus, all existing v11 behavior remains available unchanged.
    reflective = read_large_reflective_transaction(image)
    if reflective is not None:
        return reflective

    grade_prices = detect_grade_prices(image)

    # 1) Preserve the known-good traditional stacked-window path.
    stacked = read_stacked_rectangles(image)
    if stacked is not None:
        validated = validate_transaction(stacked[0], stacked[1], "stacked-transaction-panels")
        if validated is not None:
            return validated

    # 2) Very small screenshots need multi-scale reconstruction before the
    # normal row segmentation has enough pixels to distinguish segments.
    lowres = read_low_resolution_pale_transaction(image)
    if lowres is not None:
        return lowres

    # 3) Low-saturation LCDs can be falsely classified as blue because of a
    # cool tint. Handle that family before true colored LED panels.
    washed = read_washed_monochrome_panel(image)
    if washed is not None:
        return washed

    # 4) Framed monochrome LCD fallback for neutral/white displays.
    plain_mono = read_plain_monochrome_lcd(image)
    if plain_mono is not None:
        return plain_mono

    # 5) Pale low-saturation backlit LCDs need a projection-based reader.
    pale = read_pale_backlit_transaction(image)
    if pale is not None:
        return pale

    # 4) Red LCD cross-family fusion.
    red_fused = _red_fused_transaction(image)
    if red_fused is not None:
        return red_fused

    # 5) Shared strongly colored transaction displays. Require repeated
    # agreement across preprocessing variants before accepting. This adds the
    # blue-panel family without turning a single weak guess into a fuel record.
    for _, bbox, quad, family in color_panel_candidates(image):
        area_fraction = (bbox[2] * bbox[3]) / float(image.shape[0] * image.shape[1])
        if area_fraction < 0.10:
            continue
        panel = warp_quad(image, quad)
        if panel is None:
            continue
        candidates = _top_shared_candidates(panel, 80)

        # If the photograph also contains one or more small grade-price LCDs,
        # use those strictly as an independent cross-check. This is especially
        # effective on amber pumps where multiple threshold variants can agree
        # on the same wrong digit. The grade price is NOT the transaction value.
        grade_match = grade_validated_candidate(candidates, grade_prices)
        if grade_match is not None:
            chosen = grade_match["candidate"]
            amount = float(chosen["amount"])
            gallons = float(chosen["gallons"])
            return {
                "success": True,
                "method": f"{family}-shared-panel-grade-validated",
                "amount": round(amount, 2),
                "gallons": round(gallons, 4),
                "pricePerGallon": round(amount / gallons, 3),
                "confidence": "high",
                "gradeValidation": grade_match["gradePrice"],
                "gradeDelta": grade_match["gradeDelta"],
            }

        consensus = _candidate_consensus(candidates, min_votes=5)
        projection = read_projection_shared_panel(panel) if family == "amber" else None
        if consensus is None:
            # Oblique amber LCDs can defeat the connected-component reader even
            # when the projection path sees a stable, repeated digit sequence.
            # Accept that path only with strong repetition and sane transaction
            # math; otherwise preserve the conservative no-result behavior.
            if projection is not None:
                pa, pg = projection
                pav, pgv = float(pa[0]), float(pg[0])
                projection_votes = min(int(pa[3]), int(pg[3])) if len(pa) > 3 and len(pg) > 3 else 0
                projection_confidence = min(float(pa[1]), float(pg[1]))
                if (
                    projection_votes >= 6
                    and projection_confidence >= 0.62
                    and 0.50 <= pav <= 1000.0
                    and 0.05 <= pgv <= 200.0
                    and valid_derived_ppg(pav, pgv)
                ):
                    return {
                        "success": True,
                        "method": "amber-oblique-projection-consensus",
                        "amount": round(pav, 2),
                        "gallons": round(pgv, 4),
                        "pricePerGallon": round(pav / pgv, 3),
                        "confidence": "medium",
                        "projectionVotes": projection_votes,
                    }
            continue

        # Amber/yellow displays produced the most dangerous lab failure: many
        # threshold variants agreed on the same *wrong* digits.  Treat those
        # votes as correlated evidence and require an independent projection
        # decoder to agree before accepting the transaction.
        if family == "amber":
            if projection is None:
                continue
            pa, pg = projection
            if (round(float(pa[0]), 2) != round(float(consensus["amount"]), 2)
                    or round(float(pg[0]), 3) != round(float(consensus["gallons"]), 3)):
                # Usually disagreement means reject.  The one exception is a
                # strongly repeated projection read on an oblique backlit LCD:
                # connected-component threshold variants are highly correlated
                # there, while projection sees the actual digit silhouettes.
                pav, pgv = float(pa[0]), float(pg[0])
                projection_votes = min(int(pa[3]), int(pg[3])) if len(pa) > 3 and len(pg) > 3 else 0
                projection_confidence = min(float(pa[1]), float(pg[1]))
                if (
                    projection_votes >= 6
                    and projection_confidence >= 0.62
                    and 0.50 <= pav <= 1000.0
                    and 0.05 <= pgv <= 200.0
                    and valid_derived_ppg(pav, pgv)
                ):
                    return {
                        "success": True,
                        "method": "amber-oblique-projection-consensus",
                        "amount": round(pav, 2),
                        "gallons": round(pgv, 4),
                        "pricePerGallon": round(pav / pgv, 3),
                        "confidence": "medium",
                        "projectionVotes": projection_votes,
                    }
                # Otherwise prefer no result over a false fuel record.
                continue

        amount = consensus["amount"]
        gallons = consensus["gallons"]
        price = amount / gallons
        return {
            "success": True,
            "method": f"{family}-shared-panel-consensus",
            "amount": amount,
            "gallons": gallons,
            "pricePerGallon": round(price, 3),
            "confidence": "high" if consensus["votes"] >= 8 else "medium",
            "consensusVotes": consensus["votes"],
        }

    # 5) Monochrome/shared LCD panels. Require stronger repeated agreement than
    # colored displays because reflections and watermarks can mimic segments.
    for index, (_, bbox, quad) in enumerate(panel_candidates(image)[:6]):
        panel = warp_quad(image, quad)
        if panel is None:
            continue
        candidates = _top_shared_candidates(panel, 120)
        grade_match = grade_validated_candidate(candidates, grade_prices)
        if grade_match is not None:
            chosen = grade_match["candidate"]
            amount = float(chosen["amount"])
            gallons = float(chosen["gallons"])
            return {
                "success": True,
                "method": f"mono-shared-panel-grade-validated-{index}",
                "amount": round(amount, 2),
                "gallons": round(gallons, 4),
                "pricePerGallon": round(amount / gallons, 3),
                "confidence": "high",
                "gradeValidation": grade_match["gradePrice"],
                "gradeDelta": grade_match["gradeDelta"],
            }
        consensus = _candidate_consensus(candidates, min_votes=7)
        if consensus is None:
            continue
        amount = consensus["amount"]
        gallons = consensus["gallons"]
        price = amount / gallons
        # Require a healthy candidate score as well as vote count.
        if consensus["score"] > 1.35:
            continue
        return {
            "success": True,
            "method": f"mono-shared-panel-consensus-{index}",
            "amount": amount,
            "gallons": gallons,
            "pricePerGallon": round(price, 3),
            "confidence": "high" if consensus["votes"] >= 10 else "medium",
            "consensusVotes": consensus["votes"],
        }

    # 6) Upper transaction-window fallback for pump faces that also contain
    # separate grade-price displays below the completed transaction.
    upper_window = read_upper_transaction_window(image)
    if upper_window is not None:
        return upper_window

    # 7) No safe consensus. Return the best lab candidates without pretending
    # that a plausible numeric pair is a successful read.
    diagnostics = diagnose_transaction(image, max_candidates=5)
    compact = []
    for panel in diagnostics[:3]:
        for candidate in panel["candidates"][:3]:
            compact.append({
                "panel": panel["panel"],
                "amount": candidate["amount"],
                "gallons": candidate["gallons"],
                "pricePerGallon": candidate["pricePerGallon"],
                "score": candidate["score"],
            })
    return {
        "success": False,
        "method": "transaction-seven-segment-v12",
        "reason": "completed-sale-and-gallons-not-confidently-detected",
        "candidates": compact[:8],
    }

def main():
    if len(sys.argv) != 2:
        print(json.dumps({"success": False, "error": "image path required"}))
        return 2
    image = cv2.imread(sys.argv[1])
    if image is None:
        print(json.dumps({"success": False, "error": "unable to read image"}))
        return 0
    print(json.dumps(read_transaction(image)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
