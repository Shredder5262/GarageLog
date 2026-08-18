#!/usr/bin/env python3
import cv2, json, numpy as np, sys
SEGMENTS={0:set('abcdef'),1:set('bc'),2:set('abdeg'),3:set('abcdg'),4:set('bcfg'),5:set('acdfg'),6:set('acdefg'),7:set('abc'),8:set('abcdefg'),9:set('abcdfg')}

def cluster(values,tol):
    groups=[]
    for value in sorted(float(v) for v in values):
        if not groups or abs(value-float(np.mean(groups[-1])))>tol: groups.append([value])
        else: groups[-1].append(value)
    return [float(np.median(g)) for g in groups]

def iou(a,b):
    ax,ay,aw,ah,_=a; bx,by,bw,bh,_=b
    x1,y1=max(ax,bx),max(ay,by); x2,y2=min(ax+aw,bx+bw),min(ay+ah,by+bh)
    inter=max(0,x2-x1)*max(0,y2-y1)
    return inter/float(aw*ah+bw*bh-inter+1e-9)

def detect_display_rectangles(image):
    sh,sw=image.shape[:2]; scale=min(1.0,1400.0/max(sw,1))
    work=cv2.resize(image,None,fx=scale,fy=scale,interpolation=cv2.INTER_AREA) if scale<1 else image.copy()
    gray=cv2.cvtColor(work,cv2.COLOR_BGR2GRAY); h,w=gray.shape; candidates=[]
    edges=cv2.Canny(cv2.GaussianBlur(gray,(5,5),0),40,140)
    edges=cv2.morphologyEx(edges,cv2.MORPH_CLOSE,np.ones((5,5),np.uint8))
    contours,_=cv2.findContours(edges,cv2.RETR_LIST,cv2.CHAIN_APPROX_SIMPLE)
    for c in contours:
        x,y,cw,ch=cv2.boundingRect(c); aspect=cw/float(max(ch,1))
        if cw>=w*.25 and ch>=h*.05 and ch<=h*.42 and 2.2<aspect<9:
            candidates.append((x,y,cw,ch,cv2.contourArea(c)))
    hsv=cv2.cvtColor(work,cv2.COLOR_BGR2HSV)
    amber=cv2.inRange(hsv,np.array([3,55,70]),np.array([50,255,255]))
    amber=cv2.morphologyEx(amber,cv2.MORPH_CLOSE,np.ones((9,9),np.uint8))
    contours,_=cv2.findContours(amber,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
    for c in contours:
        x,y,cw,ch=cv2.boundingRect(c); aspect=cw/float(max(ch,1))
        if cw>w*.25 and ch>h*.05 and ch<h*.42 and 2.2<aspect<9:
            candidates.append((x,y,cw,ch,cv2.contourArea(c)+cw*ch*.2))
    candidates.sort(key=lambda item:item[4],reverse=True); chosen=[]
    for c in candidates:
        if all(iou(c,e)<.45 for e in chosen): chosen.append(c)
    best=None; bestscore=-1
    for i,first in enumerate(chosen[:10]):
        for second in chosen[i+1:10]:
            a,b=(first,second) if first[1]<=second[1] else (second,first)
            overlap=max(0,min(a[0]+a[2],b[0]+b[2])-max(a[0],b[0]))/float(max(1,min(a[2],b[2])))
            size=min(a[2],b[2])/float(max(a[2],b[2])); gap=(b[1]-a[1])/float(max(h,1))
            if overlap<.45 or gap<.08 or gap>.70: continue
            score=overlap+size+((a[2]+b[2])/float(max(w,1)))*.2
            if score>bestscore: bestscore=score; best=(a,b)
    if best is None: return []
    inv=1.0/scale
    return [tuple(int(round(v*inv)) for v in item[:4]) for item in best]

def binary_and_segments(crop):
    h,w=crop.shape[:2]; xm=max(2,int(w*.015)); ym=max(2,int(h*.02))
    crop=crop[ym:h-ym,xm:w-xm]; gray=cv2.cvtColor(crop,cv2.COLOR_BGR2GRAY)
    _,binary=cv2.threshold(gray,0,255,cv2.THRESH_BINARY_INV+cv2.THRESH_OTSU)
    binary[:2,:]=0; binary[-2:,:]=0; binary[:,:2]=0; binary[:,-2:]=0
    count,_,stats,_=cv2.connectedComponentsWithStats(binary,8); h,w=binary.shape; comps=[]
    for i in range(1,count):
        x,y,cw,ch,area=stats[i]
        if area<h*w*.0012: continue
        hr=cw/float(max(ch,1)); vr=ch/float(max(cw,1))
        if hr<=1.6 and vr<=1.6: continue
        comps.append({'x':x,'y':y,'w':cw,'h':ch,'area':area,'cx':x+cw/2.0,'cy':y+ch/2.0,'kind':'h' if hr>1.6 else 'v'})
    return binary,comps

def recognize_digit(binary,left,right):
    left=max(0,int(left)); right=min(binary.shape[1],int(right)); digit=binary[:,left:right]
    if digit.size==0:return None
    h,w=digit.shape; count,_,stats,_=cv2.connectedComponentsWithStats(digit,8); active=set(); dot=False
    for i in range(1,count):
        x,y,cw,ch,area=stats[i]
        if area<h*w*.005: continue
        cx=(x+cw/2.0)/float(max(w,1)); cy=(y+ch/2.0)/float(max(h,1)); hr=cw/float(max(ch,1)); vr=ch/float(max(cw,1))
        if .55<hr<1.8 and cy>.72 and area<h*w*.08:
            if cx>.70: dot=True
            continue
        if hr>1.55 and ch>=h*.055 and cw>=w*.25:
            active.add('a' if cy<.28 else 'd' if cy>.73 else 'g')
        elif vr>1.55 and cw>=w*.12 and ch>=h*.22:
            if cx>.5 and cy<.5: active.add('b')
            elif cx>.5: active.add('c')
            elif cy<.5: active.add('f')
            else: active.add('e')
    choices=[]
    for number,expected in SEGMENTS.items():
        score=len(expected-active)+len(active-expected)*1.2
        if 'a' in expected and 'a' not in active: score-=.45
        choices.append((score,number))
    score,number=sorted(choices)[0]
    return number,score,dot

def recognize_display(crop):
    binary,comps=binary_and_segments(crop); h,w=binary.shape
    hs=[q for q in comps if q['kind']=='h' and q['w']>w*.035 and q['w']<w*.18 and q['h']>h*.045 and q['h']<h*.20 and q['cy']>h*.03 and q['cy']<h*.97]
    centers=cluster([q['cx'] for q in hs],w*.045); best=[]
    for start in range(len(centers)):
        chain=[centers[start]]
        for candidate in centers[start+1:]:
            gap=candidate-chain[-1]
            if len(chain)==1:
                if w*.07<gap<w*.23: chain.append(candidate)
            else:
                spacing=float(np.median(np.diff(chain)))
                if spacing*.55<gap<spacing*1.45: chain.append(candidate)
        if len(chain)>len(best): best=chain
    centers=best
    if len(centers)<3 or len(centers)>7:return None
    spacing=float(np.median(np.diff(centers))); half=spacing*.40; digits=[]; decimal_after=None; total=0.0
    for index,center in enumerate(centers):
        r=recognize_digit(binary,center-half,center+half)
        if r is None:return None
        number,score,has_dot=r
        if score>2.1:return None
        total+=score; digits.append(str(number))
        if has_dot: decimal_after=index
    count,_,stats,_=cv2.connectedComponentsWithStats(binary,8)
    for i in range(1,count):
        x,y,cw,ch,area=stats[i]
        if area<12 or area>h*w*.015:continue
        cx,cy=x+cw/2.0,y+ch/2.0; aspect=cw/float(max(ch,1))
        if cy<h*.65 or not .4<aspect<2.4:continue
        for index in range(len(centers)-1):
            if abs(cx-(centers[index]+centers[index+1])/2.0)<spacing*.25: decimal_after=index
    text=''.join(digits)
    if decimal_after is not None:text=text[:decimal_after+1]+'.'+text[decimal_after+1:]
    try:value=float(text)
    except ValueError:return None
    confidence=max(0.0,1.0-total/max(1.0,len(digits)*2.2))
    return value,confidence,text

def main():
    if len(sys.argv)!=2:
        print(json.dumps({'success':False,'error':'image path required'})); return 2
    image=cv2.imread(sys.argv[1])
    if image is None:
        print(json.dumps({'success':False,'error':'unable to read image'})); return 0
    rects=detect_display_rectangles(image)
    if len(rects)!=2:
        print(json.dumps({'success':False,'method':'seven-segment','reason':'display-panels-not-found'})); return 0
    readings=[]
    for x,y,w,h in rects:
        readings.append(recognize_display(image[max(0,y):min(image.shape[0],y+h),max(0,x):min(image.shape[1],x+w)]))
    if any(r is None for r in readings):
        print(json.dumps({'success':False,'method':'seven-segment','reason':'digits-not-recognized'})); return 0
    amount,ac,at=readings[0]; gallons,gc,gt=readings[1]
    if not(.5<=amount<=1000 and .05<=gallons<=200):
        print(json.dumps({'success':False,'method':'seven-segment','reason':'values-out-of-range'})); return 0
    price=amount/gallons
    if not(.25<=price<=25):
        print(json.dumps({'success':False,'method':'seven-segment','reason':'implausible-price-per-gallon'})); return 0
    confidence=min(ac,gc)
    print(json.dumps({'success':True,'method':'seven-segment','amount':round(amount,2),'gallons':round(gallons,4),'pricePerGallon':round(price,3),'confidence':'high' if confidence>=.75 else 'medium','amountText':at,'gallonsText':gt}))
    return 0
if __name__=='__main__': raise SystemExit(main())
