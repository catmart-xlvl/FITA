"""FITA: surface-constrained local paint, orientation bands and safe UV padding.
Commands: setup | surface head|body IMAGE_INDEX | apply paint-plan.json
No mesh/UV editing or generation. Plans/masks are reviewed by the artist/agent.
"""
import sys, json, struct, hashlib, subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parent

def error(message): raise ValueError(message)
def local(name):
    p=(ROOT/name).resolve()
    if not p.is_relative_to(ROOT) or p==ROOT: error('PAINT_PATH_OUTSIDE_WORKSPACE')
    return p
def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest()
if len(sys.argv)>1 and sys.argv[1]=='setup':
    subprocess.run([sys.executable,'-m','pip','install','--target',str(ROOT/'.paint-libs'),'numpy','pillow','scipy'],check=True)
    sys.exit(0)
sys.path.insert(0,str(ROOT/'.paint-libs'))
runtime=ROOT/'paint-runtime.json'
if runtime.exists(): sys.path.append(json.loads(runtime.read_text(encoding='utf-8'))['pythonPackages'])
try:
    import numpy as np
    from PIL import Image
    from scipy import ndimage as ndi
    from scipy.spatial import cKDTree
    from scipy.sparse import coo_matrix
    from scipy.sparse.linalg import cg, LinearOperator
except ImportError:
    error('Faltan dependencias locales. Ejecuta: python PINTAR_TEXTURAS.py setup')

def smooth(x):
    x=np.clip(x,0,1); return x*x*(3-2*x)
def glb(p):
    b=p.read_bytes()
    if b[:4]!=b'glTF' or struct.unpack_from('<I',b,4)[0]!=2: error('PAINT_GLB_INVALID')
    chunks={};o=12
    while o<len(b):
        size,kind=struct.unpack_from('<II',b,o);o+=8;chunks[kind]=b[o:o+size];o+=size
    return json.loads(chunks[0x4e4f534a]),chunks[0x004e4942]
def accessor(j,b,index):
    a=j['accessors'][index];v=j['bufferViews'][a['bufferView']]
    if a.get('sparse') or v.get('buffer',0)!=0: error('PAINT_ACCESSOR_UNSUPPORTED')
    types={5120:'i1',5121:'u1',5122:'<i2',5123:'<u2',5125:'<u4',5126:'<f4'}
    size={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']];dt=np.dtype(types[a['componentType']])
    out=np.ndarray((a['count'],size),dtype=dt,buffer=b,offset=v.get('byteOffset',0)+a.get('byteOffset',0),strides=(v.get('byteStride',dt.itemsize*size),dt.itemsize)).copy()
    if a.get('normalized'):
        limits=np.iinfo(dt);out=np.maximum(out.astype(float)/limits.max,-1)
    if not np.isfinite(out).all(): error('PAINT_ACCESSOR_INVALID')
    return out
def quaternion(q):
    x,y,z,w=q
    return np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)], [2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)], [2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])
def node_matrix(n):
    if 'matrix' in n: return np.array(n['matrix']).reshape(4,4).T
    m=np.eye(4);m[:3,:3]=quaternion(n.get('rotation',[0,0,0,1]))@np.diag(n.get('scale',[1,1,1]));m[:3,3]=n.get('translation',[0,0,0]);return m
def instances(j):
    result=[]
    def visit(i,parent):
        n=j['nodes'][i];m=parent@node_matrix(n)
        if 'mesh' in n: result.append((i,n['mesh'],m))
        for child in n.get('children',[]): visit(child,m)
    roots=j.get('scenes',[{}])[j.get('scene',0)].get('nodes',[])
    for i in roots: visit(i,np.eye(4))
    if not roots: error('PAINT_SCENE_MISSING')
    return result
def catalog(part,index):
    if part not in ('head','body') or not isinstance(index,int): error('PAINT_ATLAS_INVALID')
    rows=json.loads((ROOT/'atlas-index.json').read_text(encoding='utf-8'))
    row=next((r for r in rows if r['part']==part and r['index']==index),None)
    if not row or not row['editable']: error('PAINT_ATLAS_PROTECTED')
    return row

def make_surface(part,index):
    row=catalog(part,index);source=local('models/'+part+'.glb');j,b=glb(source)
    image=Image.open(local('atlases/'+row['file']));w,h=image.size
    owner=np.full((h,w),-1,np.int32);face=np.full((h,w),-1,np.int32)
    position=np.zeros((h,w,3),np.float32);normal=np.zeros_like(position);ambiguous=np.zeros((h,w),bool)
    records=[]
    for node,mi,matrix in instances(j):
        for pi,p in enumerate(j['meshes'][mi]['primitives']):
            material=j.get('materials',[])[p['material']] if 'material' in p else {}
            tex=material.get('pbrMetallicRoughness',{}).get('baseColorTexture')
            if not tex or j['textures'][tex['index']].get('source')!=index: continue
            if p.get('mode',4)!=4: error('PAINT_TRIANGLES_REQUIRED')
            transform=tex.get('extensions',{}).get('KHR_texture_transform',{})
            uvname='TEXCOORD_'+str(transform.get('texCoord',tex.get('texCoord',0)))
            points=accessor(j,b,p['attributes']['POSITION']).astype(float)
            uv=accessor(j,b,p['attributes'][uvname]).astype(float)
            angle=transform.get('rotation',0);c,s=np.cos(angle),np.sin(angle)
            uv=(uv*np.array(transform.get('scale',[1,1])))@np.array([[c,-s],[s,c]]).T+np.array(transform.get('offset',[0,0]))
            if uv.min()<-1e-6 or uv.max()>1.000001: error('PAINT_WRAPPED_UV_REQUIRES_REVIEW')
            tri=accessor(j,b,p['indices']).reshape(-1,3).astype(int) if 'indices' in p else np.arange(len(points)).reshape(-1,3)
            if 'NORMAL' in p['attributes']: normals=accessor(j,b,p['attributes']['NORMAL']).astype(float)
            else:
                normals=np.zeros_like(points)
                vectors=np.cross(points[tri[:,1]]-points[tri[:,0]],points[tri[:,2]]-points[tri[:,0]])
                for k in range(3): np.add.at(normals,tri[:,k],vectors)
            points=points@matrix[:3,:3].T+matrix[:3,3]
            normals=normals@np.linalg.inv(matrix[:3,:3]);normals/=np.maximum(np.linalg.norm(normals,axis=1,keepdims=True),1e-12)
            ri=len(records);records.append({'node':node,'mesh':mi,'primitive':pi,'faces':len(tri)})
            for fi,t in enumerate(tri):
                xy=uv[t]*[w,h]-.5;lo=np.maximum(np.floor(xy.min(0)).astype(int),0);hi=np.minimum(np.ceil(xy.max(0)).astype(int)+1,[w,h])
                m=np.stack([xy[1]-xy[0],xy[2]-xy[0]],1)
                if np.any(hi<=lo) or abs(np.linalg.det(m))<1e-12: continue
                yy,xx=np.mgrid[lo[1]:hi[1],lo[0]:hi[0]];bc=(np.stack([xx,yy],-1)-xy[0])@np.linalg.inv(m).T
                inside=(bc[:,:,0]>=-1e-6)&(bc[:,:,1]>=-1e-6)&(bc.sum(-1)<=1.000001);yy,xx=yy[inside],xx[inside];bc=bc[inside];weights=np.c_[1-bc.sum(1),bc]
                xyz=weights@points[t];n=weights@normals[t];n/=np.maximum(np.linalg.norm(n,axis=1,keepdims=True),1e-12)
                prior=owner[yy,xx]>=0
                # Shared edges are fine; overlapping different surfaces cannot be painted independently.
                conflict=prior&(np.linalg.norm(position[yy,xx]-xyz,axis=1)>1e-5)
                ambiguous[yy,xx]|=conflict;position[yy,xx]=xyz;normal[yy,xx]=n;owner[yy,xx]=ri;face[yy,xx]=fi
    folder=ROOT/'paint-surfaces';folder.mkdir(exist_ok=True);stem=f'{part}_{index}'
    meta={'schema':'fita-paint-surface/v1','part':part,'index':index,'sourceHash':digest(source),'file':row['file'],'width':w,'height':h,'records':records,'ambiguousTexels':int(ambiguous.sum()),'coordinates':'glTF scene space, image origin top-left'}
    np.savez_compressed(folder/(stem+'.npz'),owner=owner,face=face,position=position,normal=normal,ambiguous=ambiguous)
    (folder/(stem+'.json')).write_text(json.dumps(meta,indent=2),encoding='utf-8')
    Image.fromarray(np.uint8((owner>=0)*255)).save(folder/(stem+'-occupied.png'))
    Image.fromarray(np.uint8(np.clip((normal+1)*127.5,0,255))).save(folder/(stem+'-orientation.png'))
    print(json.dumps(meta))

def load_surface(part,index):
    stem=f'{part}_{index}';folder=ROOT/'paint-surfaces'
    meta=json.loads((folder/(stem+'.json')).read_text(encoding='utf-8'))
    if digest(local('models/'+part+'.glb'))!=meta['sourceHash']: error('PAINT_SURFACE_SOURCE_CHANGED')
    return meta,np.load(folder/(stem+'.npz'))
def mask(name,shape):
    im=Image.open(local(name)).convert('L')
    if im.size!=(shape[1],shape[0]): error('PAINT_MASK_SIZE')
    return np.asarray(im,dtype=np.float32)/255
def domain(op,meta,maps):
    selection=op['surface'];found=[i for i,r in enumerate(meta['records']) if all(r.get(k)==selection.get(k) for k in ('mesh','primitive','node'))]
    if len(found)!=1: error('PAINT_SELECT_EXACT_NODE_MESH_PRIMITIVE')
    faces=selection['faces'];count=meta['records'][found[0]]['faces']
    if not faces or any(not isinstance(f,int) or f<0 or f>=count for f in faces) or len(set(faces))!=len(faces): error('PAINT_FACE_SELECTION_INVALID')
    return (maps['owner']==found[0])&np.isin(maps['face'],faces)

def blend_mask(op,region,maps):
    raw=mask(op['mask'],region.shape)
    if np.any((raw>0)&maps['ambiguous']): error('PAINT_SHARED_UV_REQUIRES_LOCAL_REVIEW')
    core=(raw>0)&region
    if not core.any(): error('PAINT_EMPTY_TARGET')
    feather=float(op.get('featherPx',8))
    if not np.isfinite(feather) or feather<0 or feather>256: error('PAINT_FEATHER_INVALID')
    distance=ndi.distance_transform_edt(~core)
    alpha=smooth(1-distance/max(feather,1e-6))*region
    alpha[core]=raw[core]
    support=alpha>0
    if np.any(support&maps['ambiguous']): error('PAINT_SHARED_UV_REQUIRES_LOCAL_REVIEW')
    return alpha,support

def donor_field(original,op,region,maps,support):
    donors=(mask(op['donorMask'],region.shape)>0)&region&~ndi.binary_dilation(support,iterations=2)&~maps['ambiguous']
    dy,dx=np.where(donors)
    if len(dy)<3: error('PAINT_MORE_SAME_MATERIAL_DONORS_REQUIRED')
    step=max(1,len(dy)//160000);dy,dx=dy[::step],dx[::step]
    pos=maps['position'];norm=maps['normal'];scale=max(float(np.linalg.norm(np.ptp(pos[dy,dx],axis=0))),1e-6)
    # Thin belts can have front/back samples at almost the same position. Search
    # position AND orientation so the nearest 32 samples are not all opposite-facing.
    tree=cKDTree(np.c_[pos[dy,dx]/scale,norm[dy,dx]])
    colors=original[dy,dx,:3].astype(float)
    # Include the one-pixel clean boundary so the harmonic residual meets original paint.
    needed=ndi.binary_dilation(support)&region;ys,xs=np.where(needed);field=np.zeros((*region.shape,3),np.float32)
    cosine=float(op.get('donorNormalCosine',.7))
    if not -1<=cosine<=1: error('PAINT_DONOR_ANGLE_INVALID')
    for start in range(0,len(ys),16000):
        yy,xx=ys[start:start+16000],xs[start:start+16000]
        dist,idx=tree.query(np.c_[pos[yy,xx]/scale,norm[yy,xx]],k=min(32,len(dy)))
        if dist.ndim==1: dist=dist[:,None];idx=idx[:,None]
        alignment=np.sum(norm[dy[idx],dx[idx]]*norm[yy,xx,None],axis=-1)
        distance=np.linalg.norm(pos[dy[idx],dx[idx]]-pos[yy,xx,None],axis=-1)/scale
        weights=(alignment>=cosine)*np.maximum(alignment,0)**4/(distance+.001)**2
        if np.any(weights.sum(1)==0): error('PAINT_NEED_DONORS_OF_MATCHING_SURFACE_ANGLE')
        weights/=weights.sum(1,keepdims=True);field[yy,xx]=np.sum(colors[idx]*weights[:,:,None],axis=1)
    return field,int(donors.sum())

def harmonic_residual(original,field,support,region):
    ys,xs=np.where(support);count=len(ys);lookup=np.full(region.shape,-1,np.int32);lookup[ys,xs]=np.arange(count)
    diag=np.zeros(count);rhs=np.zeros((count,3));rows=[];cols=[];h,w=region.shape
    for dy,dx in ((-1,0),(1,0),(0,-1),(0,1)):
        ny,nx=ys+dy,xs+dx;ii=np.where((ny>=0)&(ny<h)&(nx>=0)&(nx<w))[0];ii=ii[region[ny[ii],nx[ii]]];jj=lookup[ny[ii],nx[ii]];diag[ii]+=1
        unknown=jj>=0;rows.extend(ii[unknown]);cols.extend(jj[unknown]);known=~unknown
        rhs[ii[known]]+=original[ny[ii[known]],nx[ii[known]],:3]-field[ny[ii[known]],nx[ii[known]]]
    diag+=1e-4;ind=np.arange(count)
    mat=coo_matrix((np.r_[diag,-np.ones(len(rows))],(np.r_[ind,np.array(rows,dtype=int)],np.r_[ind,np.array(cols,dtype=int)])),shape=(count,count)).tocsr()
    pre=LinearOperator((count,count),matvec=lambda x:x/diag);result=field[ys,xs].astype(float)
    for k in range(3):
        residual,info=cg(mat,rhs[:,k],M=pre,rtol=1e-6,atol=1e-6,maxiter=2000)
        if info!=0: error('PAINT_SOLVER_NOT_CONVERGED')
        result[:,k]+=residual
    return ys,xs,result

def shade_field(op,normals):
    direction=np.array(op['lightDirection'],float)
    if direction.shape!=(3,) or not np.isfinite(direction).all() or np.linalg.norm(direction)<1e-8: error('PAINT_LIGHT_DIRECTION_INVALID')
    colors=[np.array(op[k],float) for k in ('shadowColor','baseColor','highlightColor')]
    if any(c.shape!=(3,) or not np.isfinite(c).all() or c.min()<0 or c.max()>255 for c in colors): error('PAINT_COLOR_INVALID')
    width=float(op.get('bandSoftness',.08))
    if not 0<width<=.5: error('PAINT_SHADOW_BAND_INVALID')
    shadow,highlight=float(op.get('shadowThreshold',.45)),float(op.get('highlightThreshold',.86))
    if not 0<=shadow<highlight<=1: error('PAINT_SHADOW_THRESHOLDS_INVALID')
    facing=(normals@(direction/np.linalg.norm(direction))+1)/2
    a=smooth((facing-shadow)/width+.5)[...,None]
    b=smooth((facing-highlight)/width+.5)[...,None]
    return (colors[0]*(1-a)+colors[1]*a)*(1-b)+colors[2]*b

def apply_plan(filename):
    planfile=local(filename);plan=json.loads(planfile.read_text(encoding='utf-8'))
    if plan.get('schema')!='fita-local-paint-plan/v1' or plan.get('reviewedRegions') is not True: error('PAINT_REVIEWED_PLAN_REQUIRED')
    outputs=[];audit={'schema':'fita-local-paint-audit/v2','planHash':digest(planfile),'imageGenerationUsed':False,'geometryChanged':False,'uvChanged':False,'atlases':[]}
    seen=set()
    for item in plan['atlases']:
        part,index=item['part'],item['index'];row=catalog(part,index);key=(part,index)
        if key in seen: error('PAINT_DUPLICATE_ATLAS')
        seen.add(key);meta,maps=load_surface(part,index);occupied=maps['owner']>=0
        src=local(item.get('input','atlases/'+row['file']));out=local('edited/'+row['file'])
        if src==out or digest(src)!=item['inputHash']: error('PAINT_IMMUTABLE_INPUT_REQUIRED')
        original=np.array(Image.open(src).convert('RGBA'));protected=np.array(Image.open(local('atlases/'+row['file'])).convert('RGBA'))
        if original.shape!=protected.shape or original.shape[:2]!=occupied.shape or not np.array_equal(original[:,:,3],protected[:,:,3]): error('PAINT_LAYOUT_OR_ALPHA_CHANGED')
        result=original.copy();changed_support=np.zeros(occupied.shape,bool);records=[]
        for op in item.get('operations',[]):
            if op.get('purpose') not in ('projection-error','dirty-shadow','contact-shadow','temporary-coverage','seam-color'): error('PAINT_EXPLICIT_PURPOSE_REQUIRED')
            region=domain(op,meta,maps);alpha,support=blend_mask(op,region,maps)
            if op['method']=='clone':
                field,donors=donor_field(result,op,region,maps,support);ys,xs,painted=harmonic_residual(result,field,support,region)
            elif op['method']=='shade':
                ys,xs=np.where(support);painted=shade_field(op,maps['normal'][ys,xs]);donors=0
            else: error('PAINT_METHOD_INVALID')
            a=alpha[ys,xs,None];result[ys,xs,:3]=np.clip(painted*a+result[ys,xs,:3]*(1-a),0,255).round().astype(np.uint8);changed_support|=support
            records.append({'id':op['id'],'purpose':op['purpose'],'method':op['method'],'pixels':int(support.sum()),'donorPixels':donors,'orientationAware':True})
        pad=item.get('paddingPx',0)
        if not isinstance(pad,int) or not 0<=pad<=256: error('PAINT_PADDING_INVALID')
        margin=np.zeros(occupied.shape,bool)
        if pad and occupied.any():
            distance,nearest=ndi.distance_transform_edt(~occupied,return_indices=True);margin=(distance>0)&(distance<=pad)
            result[margin,:3]=result[nearest[0][margin],nearest[1][margin],:3]
        allowed=changed_support|margin
        if not np.array_equal(original[~allowed],result[~allowed]) or not np.array_equal(protected[:,:,3],result[:,:,3]): error('PAINT_PROTECTED_PIXELS_CHANGED')
        entry={'part':part,'index':index,'inputHash':item['inputHash'],'file':row['file'],'sourceHash':meta['sourceHash'],'operations':records,'paddingPx':pad,'marginPixels':int(margin.sum()),'changedPixels':int(np.any(original!=result,axis=-1).sum()),'outsideBrushAndMarginPreserved':True,'alphaPreserved':True}
        outputs.append((out,result,allowed,entry));audit['atlases'].append(entry)
    # Validate the complete plan before writing anything. Never overwrite an unrelated manual edit.
    receipt=ROOT/'output'/'local-paint-audit.json';previous=json.loads(receipt.read_text()) if receipt.exists() else {}
    for out,_,_,entry in outputs:
        if out.exists() and digest(out)!=entry['inputHash'] and not (previous.get('planHash')==audit['planHash'] and any(a.get('file')==entry['file'] and a.get('outputHash')==digest(out) for a in previous.get('atlases',[]))):
            error('PAINT_OUTPUT_EXISTS_USE_IMMUTABLE_BASE_COPY')
    (ROOT/'edited').mkdir(exist_ok=True);receipt.parent.mkdir(exist_ok=True)
    for out,result,allowed,entry in outputs:
        # Keep channel count of the original atlas; PNG bytes avoid another JPEG loss.
        source_image=Image.open(local('atlases/'+entry['file']))
        has_alpha='A' in source_image.mode or 'transparency' in source_image.info
        Image.fromarray(result if has_alpha else result[:,:,:3]).save(out,format='PNG')
        entry['outputHash']=digest(out)
        Image.fromarray(np.uint8(allowed)*255).save(receipt.parent/(out.stem+'-paint-mask.png'))
    receipt.write_text(json.dumps(audit,indent=2),encoding='utf-8');print(json.dumps(audit))

if __name__=='__main__':
    try:
        args=sys.argv[1:]
        if len(args)==3 and args[0]=='surface': make_surface(args[1],int(args[2]))
        elif len(args)==2 and args[0]=='apply': apply_plan(args[1])
        else: error('Usa setup | surface head|body IMAGE_INDEX | apply paint-plan.json')
    except Exception as exc:
        print(str(exc),file=sys.stderr);sys.exit(1)
