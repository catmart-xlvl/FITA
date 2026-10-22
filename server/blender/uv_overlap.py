"""Reject UV interiors sharing raster texels; common triangle edges are excluded."""
import numpy as np

def raster_overlap(triangles,size=2048,return_faces=False):
    occupied=np.full((size,size),-1,np.int32);overlap=0;faces=set()
    for face_index,uv in enumerate(triangles):
        xy=np.array(uv)*size-.5;lo=np.maximum(np.floor(xy.min(0)).astype(int),0);hi=np.minimum(np.ceil(xy.max(0)).astype(int)+1,size);m=np.stack([xy[1]-xy[0],xy[2]-xy[0]],1)
        if np.any(hi<=lo) or abs(np.linalg.det(m))<1e-8:continue
        yy,xx=np.mgrid[lo[1]:hi[1],lo[0]:hi[0]];b=(np.stack([xx,yy],-1)-xy[0])@np.linalg.inv(m).T;inside=(b[:,:,0]>1e-5)&(b[:,:,1]>1e-5)&(b.sum(-1)<.99999)
        yy,xx=yy[inside],xx[inside];previous=occupied[yy,xx];collisions=previous>=0;count=int(collisions.sum());overlap+=count
        if return_faces and count:faces.add(face_index);faces.update(int(v) for v in np.unique(previous[collisions]))
        occupied[yy,xx]=face_index
    return (overlap,faces) if return_faces else overlap
