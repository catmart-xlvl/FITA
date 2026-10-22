import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server'/'blender'))
from connected_falloff import connected_weights, uv_seam_pairs, validate_uv_seam_pairs, validate_seam_motion, rotate_connected_points


class ConnectedHairTests(unittest.TestCase):
    def test_small_rigid_rotations_preserve_curve_and_unselected_central_hair(self):
        import math
        points=[(0,0,0),(0,0,-1),(0,.3,-2),(1,0,-1)];edges=[(0,1),(1,2)];result=points
        for _ in range(4):result=rotate_connected_points(result,edges,{0:1,1:1,2:1},(0,0,0),(1,0,0),math.radians(4),[3])
        self.assertEqual(result[0],points[0]);self.assertEqual(result[3],points[3])
        for a,b in edges:self.assertAlmostEqual(math.dist(result[a],result[b]),math.dist(points[a],points[b]))
        self.assertGreater(result[2][1],points[2][1])

    def test_rotation_rejects_protected_hair_large_angles_and_stretched_transitions(self):
        import math
        p=[(0,0,-1),(0,0,-1.001)]
        for weights,angle,protected in [({0:1},math.radians(4),[0]),({0:1,1:1},math.radians(20),[]),({0:1,1:0},math.radians(4),[])]:
            with self.assertRaises(ValueError):rotate_connected_points(p,[(0,1)],weights,(0,0,0),(1,0,0),angle,protected)

    def test_omitted_or_partial_seam_cannot_tear_a_shared_edge(self):
        points=[(0,0,0),(1,0,0),(0,0,0),(1,0,0)]
        edges=[(0,1),(2,3)]
        for seams in [[],[(0,2)]]:
            weights=connected_weights(points,edges,[1],2,seam_pairs=seams)
            with self.assertRaisesRegex(ValueError,'open a UV seam'):
                validate_seam_motion(points,edges,weights,(0,.037,0))
        weights=connected_weights(points,edges,[0],2,seam_pairs=uv_seam_pairs(points,edges))
        validate_seam_motion(points,edges,weights,(0,.037,0))

    def test_truly_separate_strands_require_their_own_seeds(self):
        points=[(0,0,0),(1,0,0),(0,.001,0),(1,.001,0)]
        edges=[(0,1),(2,3)]
        self.assertEqual(uv_seam_pairs(points,edges),[])
        single=connected_weights(points,edges,[0],2)
        self.assertNotIn(2,single)
        both=connected_weights(points,edges,[0,2],2)
        self.assertEqual(both[0],both[2])
        validate_seam_motion(points,edges,both,(0,.037,0))

    def test_motion_validation_tolerates_roundoff_but_rejects_nonfinite(self):
        points=[(0,0,0),(1,0,0),(0,0,2e-8),(1,0,2e-8)]
        edges=[(0,1),(2,3)]
        weights=connected_weights(points,edges,[0],2,seam_pairs=uv_seam_pairs(points,edges))
        validate_seam_motion(points,edges,weights,(0,.037,0))
        for delta in [(0,float('nan'),0),(0,float('inf'),0),(1,2)]:
            with self.assertRaises(ValueError):validate_seam_motion(points,edges,weights,delta)

    def test_nearby_disconnected_face_and_strand_do_not_move(self):
        points=[(0,0,0),(1,0,0),(2,0,0),(0,.001,0),(1,.001,0)]
        weights=connected_weights(points,[(0,1),(1,2),(3,4)],[0],2)
        self.assertEqual(weights[0],1)
        self.assertAlmostEqual(weights[1],.5)
        self.assertNotIn(2,weights)
        self.assertNotIn(3,weights)
        self.assertNotIn(4,weights)

    def test_folded_strand_uses_path_distance(self):
        points=[(0,0,0),(1,0,0),(1,1,0),(0,.1,0)]
        weights=connected_weights(points,[(0,1),(1,2),(2,3)],[0],1.5)
        self.assertNotIn(3,weights)

    def test_uv_seam_links_are_explicit_and_do_not_weld(self):
        points=[(0,0,0),(1,0,0),(1,0,0),(2,0,0)]
        edges=[(0,1),(2,3)]
        self.assertNotIn(2,connected_weights(points,edges,[0],3))
        weights=connected_weights(points,edges,[0],3,seam_pairs=[(1,2)])
        self.assertEqual(weights[1],weights[2])
        self.assertGreater(weights[3],0)

    def test_hard_selection_boundaries_and_invalid_inputs_fail(self):
        points=[(0,0,0),(1,0,0),(2,0,0)]
        with self.assertRaises(ValueError):connected_weights(points,[(0,1),(1,2)],[0],3,allowed=[0,1])
        for radius in [0,-1,float('inf')]:
            with self.assertRaises(ValueError):connected_weights(points,[(0,1)],[0],radius)
        with self.assertRaises(ValueError):connected_weights(points,[(0,1)],[2],3,allowed=[0,1])

    def test_shared_uv_edge_moves_both_sides_without_linking_touching_strand(self):
        points=[(0,0,0),(1,0,0),(0,1,0),(1,0,0),(0,0,0),(1,-1,0),(0,0,0),(0,0,1)]
        edges=[(0,1),(1,2),(2,0),(3,4),(4,5),(5,3),(6,7)]
        original=list(points)
        seams=uv_seam_pairs(points,edges)
        self.assertEqual(seams,[(0,4),(1,3)])
        weights=connected_weights(points,edges,[2],3,seam_pairs=seams)
        self.assertEqual(weights[0],weights[4])
        self.assertEqual(weights[1],weights[3])
        self.assertNotIn(6,weights)
        self.assertNotIn(7,weights)
        self.assertEqual(points,original)

    def test_forged_or_distant_seams_are_rejected_and_legacy_empty_is_valid(self):
        points=[(0,0,0),(1,0,0),(0,0,0),(1,0,0),(0,.001,0),(1,.001,0)]
        edges=[(0,1),(2,3),(4,5)]
        self.assertEqual(validate_uv_seam_pairs(points,edges,[]),[])
        self.assertEqual(validate_uv_seam_pairs(points,edges,[(2,0)]),[(0,2)])
        for pairs in [[(0,4)],[(0,2),(2,0)],[(0,99)],[(True,2)],[[0]]]:
            with self.assertRaises(ValueError):validate_uv_seam_pairs(points,edges,pairs)

    def test_seam_selection_cannot_bridge_protected_vertices(self):
        points=[(0,0,0),(1,0,0),(0,0,0),(1,0,0)]
        edges=[(0,1),(2,3)]
        self.assertEqual(uv_seam_pairs(points,edges,[0,1]),[])
        with self.assertRaises(ValueError):connected_weights(points,edges,[0],3,allowed=[0,1],seam_pairs=uv_seam_pairs(points,edges))

    def test_import_roundoff_at_shared_edge_is_not_a_visible_seam_crack(self):
        points=[(0,0,0),(1,0,0),(0,0,2e-8),(1,0,2e-8),(0,0,.001),(1,0,.001)]
        edges=[(0,1),(2,3),(4,5)]
        seams=uv_seam_pairs(points,edges)
        self.assertEqual(seams,[(0,2),(1,3)])
        weights=connected_weights(points,edges,[1],2,seam_pairs=seams)
        self.assertAlmostEqual(weights[0],weights[2],places=7)
        self.assertNotIn(4,weights)

if __name__=='__main__':unittest.main()
