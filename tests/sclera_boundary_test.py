import sys, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server/blender'))
from sclera_boundary import select_interior,validate_replacement

class BoundaryTests(unittest.TestCase):
 def fixture(self, rings):
  p=[[0,0,0]];t=[]
  for r in range(1,rings+2):p.extend([[r,0,0],[0,r,0],[-r,0,0],[0,-r,0]])
  for k in range(4):t.append([0,1+k,1+(k+1)%4])
  for r in range(1,rings+1):
   for k in range(4):
    a=1+(r-1)*4+k;b=1+(r-1)*4+(k+1)%4;c=1+r*4+k;d=1+r*4+(k+1)%4;t.extend([[a,c,d],[a,d,b]])
  return p,t,p[1+(rings-1)*4:1+rings*4],list(range(4+8*(rings-1),len(t)))
 def test_variable_topology_stops_at_reviewed_rim(self):
  for rings in [1,2,7]:
   p,t,rim,protected=self.fixture(rings);ids=select_interior(p,t,rim,0,protected)
   self.assertEqual(len(ids),4+8*(rings-1))
   result=validate_replacement(p,[f for i,f in enumerate(t) if i not in ids],p,[t[i] for i in ids],rim)
   self.assertTrue(result['rimMatchesRetainedEyelid'])
 def test_open_or_wrong_contour_and_protected_leak_rejected(self):
  p,t,rim,protected=self.fixture(3)
  for boundary,guard in [(rim[:-1],protected),(rim,[0]),(rim[::-1][:-1],protected)]:
   with self.assertRaises(ValueError):select_interior(p,t,boundary,0,guard)
 def test_incomplete_or_spilling_replacement_rejected(self):
  p,t,rim,protected=self.fixture(3);ids=select_interior(p,t,rim,0,protected);remaining=[f for i,f in enumerate(t) if i not in ids];replacement=[t[i] for i in ids]
  for triangles in [replacement[:-1],replacement+[remaining[0]]]:
   with self.assertRaises(ValueError):validate_replacement(p,remaining,p,triangles,rim)

if __name__=='__main__':unittest.main()
