"""Exact local identity mapping; never a geometric guess for external meshes."""
import math


def identity_correspondence(source_positions,source_faces,source_ids,positions,faces,ids):
    def require(ok):
        if not ok:raise ValueError('PLACEMENT_FACE_UV_IDENTITY_INVALID')
    def rows(points,triangles,identities):
        require(identities is not None and len(identities)==len(points))
        require(all(isinstance(v,(int,float)) and math.isfinite(v) and v==int(v) and 0<=v<2**24 for v in identities))
        result={};coordinates={}
        for point,identity in zip(points,identities):
            require(len(point)==3 and all(math.isfinite(v) for v in point))
            if identity in coordinates:require(math.dist(point,coordinates[identity])<=2e-7)
            coordinates[identity]=point
        for f,tri in enumerate(triangles):
            require(len(tri)==3 and all(isinstance(v,int) and 0<=v<len(points) for v in tri))
            corner_ids=[identities[v] for v in tri];key=tuple(sorted(corner_ids))
            require(len(set(corner_ids))==3 and key not in result)
            result[key]=(f,corner_ids,tri)
        return result
    a=rows(source_positions,source_faces,source_ids);b=rows(positions,faces,ids)
    require(bool(a) and a.keys()==b.keys())
    assignments=[]
    for key,(f,old,tri) in a.items():
        g,new,other=b[key];order=[new.index(v) for v in old]
        require(all(math.dist(source_positions[tri[k]],positions[other[order[k]]])<=2e-7 for k in range(3)))
        assignments.append((f,g,order))
    return assignments
