"""Continuous hidden seams on disposable, Y-up facial unwrap proxies."""
import heapq
import math
import numpy as np
from collections import defaultdict


def disk_seams(vertices,faces):
    """One UV disk per manifold surface, without changing source corners.

    A dual spanning tree joins all triangles into a disk. Its complement is
    a cut graph. Pruning interior leaves removes redundant seams while
    retaining the cuts needed for handles and multiple boundary loops.
    Keep expensive front edges joined; prefer short cuts toward the rear.
    """
    adjacent=defaultdict(list)
    for f,triangle in enumerate(faces):
        for a,b in zip(triangle,triangle[1:]+triangle[:1]):adjacent[tuple(sorted((a,b)))].append(f)
    if not faces or any(len(fs)>2 for fs in adjacent.values()):raise ValueError('PLACEMENT_FACE_UV_TOPOLOGY')
    parent=list(range(len(faces)))
    def root(f):
        while parent[f]!=f:parent[f]=parent[parent[f]];f=parent[f]
        return f
    ids=sorted({v for face in faces for v in face});lo=[min(vertices[v][k] for v in ids) for k in range(3)];hi=[max(vertices[v][k] for v in ids) for k in range(3)]
    span=[max(hi[k]-lo[k],1e-9) for k in range(3)];middle=(lo[0]+hi[0])/2
    def cost(edge):
        p=[(vertices[edge[0]][k]+vertices[edge[1]][k])/2 for k in range(3)]
        front=(p[2]-lo[2])/span[2];central=max(0,1-2*abs(p[0]-middle)/span[0])
        return math.dist(vertices[edge[0]],vertices[edge[1]])*(1+32*front**4*(1+central))
    joined=set()
    for edge,fs in sorted(adjacent.items(),key=lambda item:(-cost(item[0]),item[0])):
        if len(fs)!=2:continue
        a,b=map(root,fs)
        if a!=b:parent[a]=b;joined.add(edge)
    if len({root(f) for f in range(len(faces))})!=1:raise ValueError('PLACEMENT_FACE_UV_TOPOLOGY')
    cuts=set(adjacent)-joined;boundary={v for e,fs in adjacent.items() if len(fs)==1 for v in e}
    incident=defaultdict(set)
    for e in cuts:
        for v in e:incident[v].add(e)
    queue=[v for v,es in incident.items() if v not in boundary and len(es)==1]
    while queue:
        v=queue.pop()
        if v in boundary or len(incident[v])!=1:continue
        # A closed sphere still needs a nontrivial slit for a disk boundary.
        if not boundary and len(cuts)<=3:break
        e=next(iter(incident[v]));cuts.remove(e)
        for p in e:
            incident[p].remove(e)
            if p not in boundary and len(incident[p])==1:queue.append(p)
    return {e for e in cuts if len(adjacent[e])==2}


def chart_folded(triangles):
    """Catch subpixel folds that raster occupancy alone cannot detect."""
    signs=set()
    for a,b,c in triangles:
        u=[b[k]-a[k] for k in range(2)];v=[c[k]-a[k] for k in range(2)]
        area=u[0]*v[1]-u[1]*v[0]
        # Blender stores loop UVs as float32. Quantized near-collinear
        # triangles can change determinant sign after a pack transform.
        # Bound that coordinate-rounding error, rather than hiding folds
        # using a raster-size threshold (real subpixel folds still count).
        # Budget four coordinate roundings: solver write, pack rotation,
        # scale and translation. This is independent of raster resolution.
        delta=max(abs(x) for p in (a,b,c) for x in p)*2**-22
        uncertainty=2*delta*sum(map(abs,u+v))+8*delta*delta
        if abs(area)>uncertainty:signs.add(area>0)
    return len(signs)>1


def split_vertex_fans(vertices, faces):
    """Do not weld unrelated sheets that meet only at a source position."""
    edges={};incident={}
    for i,face in enumerate(faces):
        for v in face:incident.setdefault(v,set()).add(i)
        for a,b in zip(face,face[1:]+face[:1]):edges.setdefault(tuple(sorted((a,b))),[]).append(i)
    result=[list(f) for f in faces];out=list(vertices);splits=0
    for v,linked in incident.items():
        graph={f:set() for f in linked}
        for f in linked:
            for other in faces[f]:
                if other==v:continue
                fs=edges[tuple(sorted((v,other)))]
                if len(fs)==2:graph[f].update(fs)
        unseen=set(linked);first=True
        while unseen:
            stack=[unseen.pop()];group=set(stack)
            while stack:
                for f in graph[stack.pop()]&unseen:unseen.remove(f);group.add(f);stack.append(f)
            if first:first=False;continue
            target=len(out);out.append(vertices[v]);splits+=1
            for f in group:result[f]=[target if n==v else n for n in result[f]]
    return out,result,splits


def rear_seam(vertices, edges):
    """Return a connected rear path, rather than disconnected plane crossings.

    Vertices and edges belong to one surface. This changes only UV seams.
    The front (+Z) and silhouette are expensive, keeping the cut at the back.
    """
    ids=sorted({v for edge in edges for v in edge})
    if len(ids)<3:return set()
    lo=[min(vertices[v][k] for v in ids) for k in range(3)]
    hi=[max(vertices[v][k] for v in ids) for k in range(3)]
    span=[max(hi[k]-lo[k],1e-9) for k in range(3)]
    middle=(hi[0]+lo[0])/2
    score=lambda v:(vertices[v][2]-lo[2])/span[2]+abs(vertices[v][0]-middle)/span[0]
    lower=[v for v in ids if vertices[v][1]<=lo[1]+span[1]*.08]
    upper=[v for v in ids if vertices[v][1]>=hi[1]-span[1]*.08]
    start=min(lower,key=lambda v:(score(v),v));end=min(upper,key=lambda v:(score(v),v))
    if start==end:end=max(ids,key=lambda v:math.dist(vertices[v],vertices[start]))
    graph={v:[] for v in ids}
    for a,b in edges:
        distance=math.dist(vertices[a],vertices[b])
        cost=distance*(1+8*(score(a)+score(b))/2)
        graph[a].append((b,cost));graph[b].append((a,cost))
    queue=[(0,start)];distance={start:0};parent={}
    while queue:
        cost,v=heapq.heappop(queue)
        if cost!=distance[v]:continue
        if v==end:break
        for other,weight in graph[v]:
            new=cost+weight
            if new<distance.get(other,float('inf')):
                distance[other]=new;parent[other]=v;heapq.heappush(queue,(new,other))
    if end not in parent:raise ValueError('PLACEMENT_FACE_UV_SEAM_REQUIRED')
    result=set();v=end
    while v!=start:
        other=parent[v];result.add(tuple(sorted((v,other))));v=other
    return result


def convex_chart(mesh, layer, selected,preserve_boundary=False):
    """Injective genus-zero fallback: convex rim, temporary hole fillers, CG.

    Fillers exist only in the linear system. They never enter source geometry
    or baking. Reject branched boundaries or handles instead of cutting skin.
    """
    ids={};loops={};positions=[];old_uv=[];edges={};triangles=[]
    for f in sorted(selected):
        face=mesh.polygons[f];vertices=[]
        for l in face.loop_indices:
            v=mesh.loops[l].vertex_index;uv=layer.data[l].uv
            key=(v,round(uv.x,6),round(uv.y,6))
            if key not in ids:ids[key]=len(positions);positions.append(tuple(mesh.vertices[v].co));old_uv.append(tuple(uv));loops[ids[key]]=[]
            i=ids[key];loops[i].append(l);vertices.append(i)
        triangles.append(vertices)
        for a,b in zip(vertices,vertices[1:]+vertices[:1]):edges[tuple(sorted((a,b)))]=edges.get(tuple(sorted((a,b))),0)+1
    graph=[set() for _ in positions];boundary={}
    for (a,b),n in edges.items():
        graph[a].add(b);graph[b].add(a)
        if n==1:boundary.setdefault(a,set()).add(b);boundary.setdefault(b,set()).add(a)
        if n>2:raise ValueError('PLACEMENT_FACE_UV_TOPOLOGY')
    if not boundary or any(len(n)!=2 for n in boundary.values()):raise ValueError('PLACEMENT_FACE_UV_TOPOLOGY')
    unseen=set(boundary);rims=[]
    while unseen:
        start=min(unseen);rim=[start];previous=None;v=start
        while True:
            following=next(n for n in sorted(boundary[v]) if n!=previous)
            if following==start:break
            if following in rim:raise ValueError('PLACEMENT_FACE_UV_TOPOLOGY')
            rim.append(following);previous,v=v,following
        unseen-=set(rim);rims.append(rim)
    if len(positions)-len(edges)+len(triangles)!=2-len(rims):raise ValueError('PLACEMENT_FACE_UV_TOPOLOGY')
    outer=max(rims,key=lambda r:sum(math.dist(positions[a],positions[b]) for a,b in zip(r,r[1:]+r[:1])))
    for rim in rims:
        if rim is outer or preserve_boundary:continue
        dummy=len(graph);graph.append(set(rim))
        for v in rim:graph[v].add(dummy)
    lengths=np.array([math.dist(positions[a],positions[b]) for a,b in zip(outer,outer[1:]+outer[:1])]);angles=np.r_[0,np.cumsum(lengths[:-1])]/sum(lengths)*2*math.pi
    fixed={v:np.array([math.cos(a),math.sin(a)]) for v,a in zip(outer,angles)}
    if preserve_boundary:fixed={v:np.array(old_uv[v]) for v in boundary}
    interior=[v for v in range(len(graph)) if v not in fixed];index={v:i for i,v in enumerate(interior)};n=len(interior)
    rows=[];cols=[];rhs=np.zeros((n,2));diagonal=np.array([len(graph[v]) for v in interior],float)
    for v,i in index.items():
        for other in graph[v]:
            if other in index:rows.append(i);cols.append(index[other])
            else:rhs[i]+=fixed[other]
    rows=np.array(rows,dtype=np.int64);cols=np.array(cols,dtype=np.int64)
    def product(x):return diagonal*x-np.bincount(rows,weights=x[cols],minlength=n)
    solution=np.zeros((n,2));iterations=0
    for axis in range(2):
        if not n:break
        x=np.zeros(n);r=rhs[:,axis].copy();z=r/diagonal;p=z.copy();rz=np.dot(r,z)
        for iteration in range(2500):
            ap=product(p);denom=np.dot(p,ap)
            if abs(denom)<1e-30:break
            alpha=rz/denom;x+=alpha*p;r-=alpha*ap
            if np.max(np.abs(r))<1e-11:break
            z=r/diagonal;new=np.dot(r,z);p=z+(new/rz)*p;rz=new
        if np.max(np.abs(r))>1e-8:raise ValueError('PLACEMENT_FACE_UV_SOLVE_TIMEOUT')
        iterations=max(iterations,iteration+1);solution[:,axis]=x
    result=np.array([fixed[v] if v in fixed else solution[index[v]] for v in range(len(positions))])
    # Orient the chart using source X/Y rather than an arbitrary boundary index.
    if not preserve_boundary:
        projected=np.array(positions)[:,:2];left,_,right=np.linalg.svd((result-result.mean(0)).T@(projected-projected.mean(0)));result=result@(left@right)
    for v,ls in loops.items():
        for l in ls:layer.data[l].uv=result[v]
    return {'vertices':len(positions),'boundaryLoops':len(rims),'iterations':iterations,'preservedBoundary':preserve_boundary}
