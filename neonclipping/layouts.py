"""NeonClipping's native layout geometry, shared by browser preview and FFmpeg."""
import math

CATALOG = [
    ('stack', 'Face + gameplay', 'Camera above the action'),
    ('bottom', 'Gameplay + face', 'Camera below the action'),
    ('blur', 'Blurred fill', 'Keep the complete source'),
    ('fill', 'Fill screen', 'Full-frame centre crop'),
    ('game', 'Gameplay only', 'Use your selected game area'),
    ('pip_tl', 'Camera top-left', 'Floating selected facecam'),
    ('pip_tr', 'Camera top-right', 'Floating selected facecam'),
    ('pip_bl', 'Camera bottom-left', 'Floating selected facecam'),
    ('pip_br', 'Camera bottom-right', 'Floating selected facecam'),
    ('circle', 'Circle camera', 'Round facecam above gameplay'),
    ('side', 'Side by side', 'Camera and gameplay columns'),
]

def text_positions(name, top=.32, caption_y=1450):
    spec=geometry(name,top)
    cam=next((layer for layer in spec['layers'] if layer['source']=='cam'),None)
    hook_y=260
    if cam and cam['y']<100:
        hook_y=cam['y']+cam['h']+30
    if name=='side':hook_y=260
    if caption_y==1450 and cam and cam['y']>900:
        caption_y=min(caption_y,cam['y']-120)
    return {'hook_y':hook_y,'caption_y':caption_y}

def geometry(name, top=.32):
    if name not in {x[0] for x in CATALOG}:
        raise ValueError('Choose a valid layout.')
    top = float(top)
    if not math.isfinite(top) or not .2 <= top <= .5:
        raise ValueError('Face size must be between 20% and 50%.')
    h = int(top * 1920) // 2 * 2
    full = {'source': 'full', 'x': 0, 'y': 0, 'w': 1080, 'h': 1920}
    game = {**full, 'source': 'game'}
    if name == 'blur': return {'mode': 'blur', 'layers': []}
    if name == 'fill': return {'mode': 'layers', 'layers': [full]}
    if name == 'game': return {'mode': 'layers', 'layers': [game]}
    if name in ('stack', 'bottom'):
        cam = {'source':'cam', 'x':0, 'y':0 if name == 'stack' else 1920-h, 'w':1080, 'h':h}
        return {'mode':'layers', 'layers':[
            {**game, 'y':h if name == 'stack' else 0, 'h':1920-h}, cam]}
    if name == 'side':
        w = int(top * 1080) // 2 * 2
        return {'mode':'layers', 'layers':[
            {**game, 'x':w, 'w':1080-w}, {'source':'cam','x':0,'y':0,'w':w,'h':1920}]}
    w = int(top * 1080) // 2 * 2
    size = w if name == 'circle' else int(w * .9) // 2 * 2
    right = name in ('pip_tr','pip_br')
    bottom = name in ('pip_bl','pip_br')
    return {'mode':'layers', 'layers':[game, {
        'source':'cam', 'x':1080-w-36 if right else 36,
        'y':1920-size-180 if bottom else 72, 'w':w, 'h':size,
        'circle':name == 'circle'}]}

def render_graph(name, rects, top=.32):
    spec = geometry(name, top)
    if spec['mode'] == 'blur':
        return '[0:v]split=2[b][f];[b]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,boxblur=8:2,scale=1080:1920[bg];[f]scale=1080:1920:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[base]'
    layers = spec['layers']; parts=[]
    if len(layers)>1: parts.append('[0:v]split='+str(len(layers))+''.join(f'[s{i}]' for i in range(len(layers))))
    for i, layer in enumerate(layers):
        source = f'[s{i}]' if len(layers)>1 else '[0:v]'
        crop = ''
        if layer['source'] != 'full':
            x,y,w,h = rects[0 if layer['source']=='cam' else 1]
            crop = f'crop={w}:{h}:{x}:{y},'
        w,h = layer['w'],layer['h']
        mask = ''
        if layer.get('circle'):
            mask = ",format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte(pow(X-W/2,2)+pow(Y-H/2,2),pow(min(W,H)/2,2)),255,0)'"
        parts.append(source+crop+f'scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},setsar=1'+mask+f'[p{i}]')
    first = layers[0]
    parts.append(f"[p0]pad=1080:1920:{first['x']}:{first['y']}:black[b0]")
    for i, layer in enumerate(layers[1:],1):
        parts.append(f"[b{i-1}][p{i}]overlay={layer['x']}:{layer['y']}:shortest=1[b{i}]")
    parts.append(f'[b{len(layers)-1}]null[base]')
    return ';'.join(parts)
