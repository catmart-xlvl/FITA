import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server'/'blender'))
from uv_overlap import raster_overlap

class OverlapFacesTest(unittest.TestCase):
    def test_adjacent_edges_are_not_overlaps(self):
        triangles=[[(0,0),(1,0),(0,1)],[(1,0),(1,1),(0,1)]]
        self.assertEqual(raster_overlap(triangles,size=64,return_faces=True),(0,set()))

    def test_duplicate_interiors_identify_only_the_colliding_source_faces(self):
        a=[(0,0),(.4,0),(0,.4)];other=[(.6,.6),(1,.6),(.6,1)]
        triangles=[a,other,a]
        count,faces=raster_overlap(triangles,size=64,return_faces=True)
        self.assertGreater(count,0);self.assertEqual(faces,{0,2})
        self.assertEqual(raster_overlap(triangles,size=64),count)

    def test_skipped_degenerate_faces_do_not_shift_source_identity(self):
        triangles=[[(0,0),(0,0),(0,0)],[(0,0),(1,0),(0,1)],[(0,1),(1,0),(0,0)]]
        count,faces=raster_overlap(triangles,size=64,return_faces=True)
        self.assertGreater(count,0);self.assertEqual(faces,{1,2})

if __name__=='__main__':unittest.main()
