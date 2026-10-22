"""Topology guards for an artist-reviewed anatomical eyelid rim.

No colour threshold, fixed ring count or character-specific coordinates. Coordinates
are welded for analysis only; source geometry and UV seam vertices are not modified.
"""
from collections import defaultdict, deque
import math


def require(ok):
    if not ok:
        raise ValueError('SCLERA_BOUNDARY_INVALID')


def key(p):
    require(len(p) == 3 and all(math.isfinite(float(x)) for x in p))
    return tuple(round(float(x), 5) for x in p)


def edge(a, b):
    return tuple(sorted((a, b)))


def mesh_edges(positions, triangles):
    points = [key(p) for p in positions]
    edges = defaultdict(list)
    for i, tri in enumerate(triangles):
        require(len(tri) == 3 and all(isinstance(v, int) and 0 <= v < len(points) for v in tri))
        q = [points[v] for v in tri]
        require(len(set(q)) == 3)
        for a, b in zip(q, q[1:] + q[:1]):
            edges[edge(a, b)].append(i)
    return edges


def rim_edges(boundary):
    rim = [key(p) for p in boundary]
    require(len(rim) >= 3 and len(set(rim)) == len(rim))
    return {edge(a, b) for a, b in zip(rim, rim[1:] + rim[:1])}


def select_interior(positions, triangles, boundary, seed_face, protected_faces):
    """Flood from an interior seed; stop at the reviewed closed source-edge rim.

    The caller must identify this rim visually in multiple views and provide at
    least one outside/protected face. A rim is a barrier, not a growth radius.
    """
    edges = mesh_edges(positions, triangles)
    barrier = rim_edges(boundary)
    require(barrier <= edges.keys())
    require(all(len(edges[e]) == 2 for e in barrier))
    require(isinstance(seed_face, int) and 0 <= seed_face < len(triangles))
    protected = set(protected_faces)
    require(protected and all(isinstance(i, int) and 0 <= i < len(triangles) for i in protected))
    adjacency = defaultdict(set)
    for e, faces in edges.items():
        if e not in barrier:
            for f in faces:
                adjacency[f].update(faces)
    selected, queue = set(), deque([seed_face])
    while queue:
        f = queue.popleft()
        if f in selected:
            continue
        require(f not in protected)
        selected.add(f)
        queue.extend(adjacency[f] - selected)
    actual = {e for e, faces in edges.items() if sum(f in selected for f in faces) == 1}
    require(actual == barrier)
    return sorted(selected)


def validate_replacement(source_positions, remaining_triangles, positions, triangles, boundary):
    """Replacement must be one connected disk, ending on the retained eyelid rim."""
    barrier = rim_edges(boundary)
    source = mesh_edges(source_positions, remaining_triangles)
    require(all(len(source.get(e, [])) == 1 for e in barrier))
    edges = mesh_edges(positions, triangles)
    require(all(len(fs) <= 2 for fs in edges.values()))
    require({e for e, fs in edges.items() if len(fs) == 1} == barrier)
    adjacency = defaultdict(set)
    for faces in edges.values():
        for f in faces:
            adjacency[f].update(faces)
    visited, queue = set(), deque([0])
    while queue:
        f = queue.popleft()
        if f not in visited:
            visited.add(f)
            queue.extend(adjacency[f] - visited)
    require(len(visited) == len(triangles))
    vertices = {v for e in edges for v in e}
    require(len(vertices) - len(edges) + len(triangles) == 1)
    return {'closedRim': True, 'rimMatchesRetainedEyelid': True, 'connectedDisk': True,
            'boundaryVertices': len(boundary), 'semanticReviewRequired': True}
