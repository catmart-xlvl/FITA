import sys,unittest,math,copy
from collections import defaultdict
from pathlib import Path
from types import SimpleNamespace as NS
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server/blender'))
from face_uv_topology import rear_seam,split_vertex_fans,convex_chart,disk_seams,chart_folded
from uv_overlap import raster_overlap

class UV(list):
    x=property(lambda self:self[0]);y=property(lambda self:self[1])

class TopologyTests(unittest.TestCase):
    def assert_disk(self,points,faces):
        original=copy.deepcopy((points,faces));seams=disk_seams(points,faces)
        self.assertEqual((points,faces),original)
        # Split corner identity only at the returned seams, as an unwrap does.
        parent=list(range(len(faces)*3));edges=defaultdict(list)
        def root(v):
            while parent[v]!=v:parent[v]=parent[parent[v]];v=parent[v]
            return v
        for f,face in enumerate(faces):
            for k in range(3):edges[tuple(sorted((face[k],face[(k+1)%3])))].append(f)
        for edge,fs in edges.items():
            if len(fs)!=2 or edge in seams:continue
            for v in edge:parent[root(fs[0]*3+faces[fs[0]].index(v))]=root(fs[1]*3+faces[fs[1]].index(v))
        result=[[root(f*3+k) for k in range(3)] for f in range(len(faces))]
        counts=defaultdict(int);boundary=defaultdict(set);face_graph=[set() for _ in faces]
        edge_faces=defaultdict(list)
        for f,face in enumerate(result):
            for a,b in zip(face,face[1:]+face[:1]):counts[tuple(sorted((a,b)))]+=1;edge_faces[tuple(sorted((a,b)))].append(f)
        for (a,b),n in counts.items():
            self.assertLessEqual(n,2)
            if n==1:boundary[a].add(b);boundary[b].add(a)
        self.assertTrue(boundary);self.assertEqual(set(map(len,boundary.values())),{2})
        self.assertEqual(len({v for face in result for v in face})-len(counts)+len(faces),1)
        for fs in edge_faces.values():
            for f in fs:face_graph[f].update(fs)
        reached={0};stack=[0]
        while stack:
            for f in face_graph[stack.pop()]-reached:reached.add(f);stack.append(f)
        self.assertEqual(len(reached),len(faces))
    def test_cut_graph_opens_torus_and_punctured_torus_without_fragmentation(self):
        n,m=9,7
        points=[((2+math.cos(j*2*math.pi/m))*math.cos(i*2*math.pi/n),(2+math.cos(j*2*math.pi/m))*math.sin(i*2*math.pi/n),math.sin(j*2*math.pi/m)) for i in range(n) for j in range(m)]
        faces=[]
        for i in range(n):
            for j in range(m):
                a=i*m+j;b=((i+1)%n)*m+j;c=((i+1)%n)*m+(j+1)%m;d=i*m+(j+1)%m
                faces.extend([[a,b,c],[a,c,d]])
        self.assert_disk(points,faces);self.assert_disk(points,faces[2:])
    def test_cut_graph_opens_annulus_and_closed_sphere(self):
        points=[(r*math.cos(i*math.pi/4),r*math.sin(i*math.pi/4),0) for r in (1,2) for i in range(8)]
        faces=[]
        for i in range(8):
            a=i;b=(i+1)%8;c=8+b;d=8+a;faces.extend([[a,b,c],[a,c,d]])
        self.assert_disk(points,faces)
        self.assert_disk([(1,0,0),(-1,0,0),(0,1,0),(0,0,1)],[[0,1,2],[0,3,1],[1,3,2],[2,3,0]])
    def test_cut_graph_rejects_ambiguous_and_disconnected_surfaces(self):
        points=[(i,0,0) for i in range(6)]
        for faces in ([[0,1,2],[1,0,3],[0,1,4]],[[0,1,2],[3,4,5]]):
            with self.assertRaisesRegex(ValueError,'PLACEMENT_FACE_UV_TOPOLOGY'):disk_seams(points,faces)
    def test_subpixel_fold_is_detected_even_when_no_texel_is_covered(self):
        triangles=[[(.4,.4),(.40001,.4),(.4,.40001)],[(.40001,.4),(.4,.4),(.400005,.400005)]]
        self.assertEqual(raster_overlap(triangles,2048),0);self.assertTrue(chart_folded(triangles))
        self.assertFalse(chart_folded([triangles[0],list(reversed(triangles[1]))]))
    def test_float32_rounding_of_collinear_packed_details_is_not_a_fold(self):
        triangles=[[(.8,.1),(.81,.1),(.8,.11)],[(.8,.1),(.801,.101),(.802,.1019999999)]]
        self.assertFalse(chart_folded(triangles))
    def test_rear_seam_is_one_connected_path(self):
        points=[(0,0,-1),(0,.5,-1),(0,1,-1),(0,0,1),(0,.5,1),(0,1,1)]
        edges=[(0,1),(1,2),(3,4),(4,5),(0,3),(2,5)]
        self.assertEqual(rear_seam(points,edges),{(0,1),(1,2)})
    def test_unrelated_vertex_fans_are_split_without_changing_corners(self):
        points=[(0,0,0),(1,0,0),(0,1,0),(-1,0,0),(0,-1,0)];faces=[[0,1,2],[0,3,4]]
        out,triangles,count=split_vertex_fans(points,faces)
        self.assertEqual(count,1)
        self.assertEqual([[out[v] for v in t] for t in triangles],[[points[v] for v in t] for t in faces])
        self.assertFalse(set(triangles[0])&set(triangles[1]))
    def test_convex_fallback_untangles_a_folded_disk_without_extra_islands(self):
        positions=[(-1,-1,0),(1,-1,0),(1,1,0),(-1,1,0),(0,0,0)];triangles=[[0,1,4],[1,2,4],[2,3,4],[3,0,4]]
        starting=[(.1,.1),(.9,.1),(.9,.9),(.1,.9),(1.2,.5)];loops=[];polygons=[];data=[]
        for triangle in triangles:
            ids=[]
            for v in triangle:ids.append(len(loops));loops.append(NS(vertex_index=v));data.append(NS(uv=UV(starting[v])))
            polygons.append(NS(loop_indices=ids))
        mesh=NS(polygons=polygons,loops=loops,vertices=[NS(co=p) for p in positions]);layer=NS(data=data)
        report=convex_chart(mesh,layer,set(range(4)))
        self.assertEqual(report['boundaryLoops'],1)
        for item in data:item.uv=(item.uv+2)/4
        self.assertEqual(raster_overlap([[data[l].uv for l in p.loop_indices] for p in polygons],128),0)

if __name__=='__main__':unittest.main()
