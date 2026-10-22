import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server/blender'))
from face_uv_identity import identity_correspondence


class IdentityTests(unittest.TestCase):
    def setUp(self):
        self.positions=[(0,0,0),(1,0,0),(0,1,0)]*2
        self.faces=[[0,1,2],[3,4,5]];self.ids=list(range(6))
    def test_coincident_source_faces_retain_distinct_vertex_identities(self):
        result=identity_correspondence(self.positions,self.faces,self.ids,list(reversed(self.positions)),[[0,1,2],[3,4,5]],list(reversed(self.ids)))
        self.assertEqual(result,[(0,1,[2,1,0]),(1,0,[2,1,0])])
    def test_seam_vertex_duplicates_are_allowed_without_welding(self):
        positions=self.positions+[self.positions[0]]
        result=identity_correspondence(self.positions,self.faces,self.ids,positions,[[6,1,2],[3,4,5]],self.ids+[0])
        self.assertEqual(len(result),2)
    def test_missing_ambiguous_or_moved_identity_is_rejected(self):
        cases=[(self.positions,self.faces,None),(self.positions,[[0,1,2],[0,1,2]],self.ids),(self.positions,[[0,1,2]],self.ids),([(1e-4,0,0)]+self.positions[1:],self.faces,self.ids),(self.positions,self.faces,[.5]+self.ids[1:])]
        for positions,faces,ids in cases:
            with self.assertRaisesRegex(ValueError,'PLACEMENT_FACE_UV_IDENTITY_INVALID'):identity_correspondence(self.positions,self.faces,self.ids,positions,faces,ids)

if __name__=='__main__':unittest.main()
