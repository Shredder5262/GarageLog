#!/usr/bin/env python3
"""GarageLog fuel-pump transaction display reader.

This reader is intentionally transaction-specific. It looks for a completed-sale
pair (Total/This Sale above Gallons), reads those two seven-segment rows, and
returns only the sale amount and gallons. Pump grade price boards are rejected.
"""
import cv2
import json
import numpy as np
import sys

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
    if not (0.50 <= price <= 9.99):
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


def read_transaction(image):
    # Traditional pumps often use two stacked transaction windows. Read these
    # first because the geometry is more specific than the shared-panel search.
    stacked = read_stacked_rectangles(image)
    if stacked is not None:
        validated = validate_transaction(stacked[0], stacked[1], "stacked-transaction-panels")
        if validated is not None:
            return validated

    candidates = panel_candidates(image)

    # Newer pumps often use one shared display panel containing sale above gallons.
    for _, bbox, quad in candidates:
        x, y, w, h = bbox
        if h < image.shape[0] * 0.12 or w / float(max(h, 1)) > 6.5:
            continue
        panel = warp_quad(image, quad)
        if panel is None:
            continue
        result = read_shared_panel(panel)
        if result is not None:
            validated = validate_transaction(result[0], result[1], "transaction-panel")
            if validated is not None:
                return validated

    return {
        "success": False,
        "method": "transaction-seven-segment",
        "reason": "completed-sale-and-gallons-not-confidently-detected",
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
