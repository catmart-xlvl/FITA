"""Deterministic smooth proportional weights along reviewed mesh connectivity."""
import heapq
import math


def rotate_connected_points(points, edges, weights, pivot, axis, angle, protected=()):
    """Small, replayable rotations of one reviewed strand around a stable hinge.

    Full-weight vertices undergo a rigid rotation, preserving strand shape. Check
    the transition for stretch and duplicated seams before accepting the step.
    """
    if any(len(v)!=3 or not all(math.isfinite(float(c)) for c in v) for v in [pivot,axis]) or not math.isfinite(angle) or abs(angle)>math.radians(5)+1e-9:
        raise ValueError('Use a finite pivot/axis and rotation increments of at most five degrees')
    length=math.sqrt(sum(c*c for c in axis))
    if length<1e-8:raise ValueError('Rotation axis cannot be zero')
    if any(weights.get(i,0)>1e-8 for i in protected):raise ValueError('Rotation reaches protected hair; isolate the strand and its stable roots')
    axis=[c/length for c in axis];result=[tuple(p) for p in points]
    for i,w in weights.items():
        if not 0<=w<=1:raise ValueError('Invalid rotation influence')
        v=[points[i][j]-pivot[j] for j in range(3)];c=math.cos(angle*w);s=math.sin(angle*w);dot=sum(a*b for a,b in zip(axis,v));cross=[axis[1]*v[2]-axis[2]*v[1],axis[2]*v[0]-axis[0]*v[2],axis[0]*v[1]-axis[1]*v[0]]
        result[i]=tuple(pivot[j]+v[j]*c+cross[j]*s+axis[j]*dot*(1-c) for j in range(3))
    for a,b in edges:
        old=math.dist(points[a],points[b]);new=math.dist(result[a],result[b])
        if old>1e-6 and not .90<=new/old<=1.10:raise ValueError(f'Rotation transition stretches or compresses edge {a}:{b} ({new/old:.4f}); widen the blend or reduce the angle')
    for a,b in uv_seam_pairs(points,edges):
        if math.dist(result[a],result[b])>math.dist(points[a],points[b])+1e-6:raise ValueError('Rotation would open a UV seam')
    return result


def uv_seam_pairs(points, edges, allowed=None):
    """Virtual links for numerically identical endpoints of source seam edges.

    A shared point alone or spatial proximity never creates a link. Shared
    geometric edges identify UV/normal splits without welding the real mesh.
    """
    count = len(points)
    allowed = set(range(count)) if allowed is None else set(allowed)
    # Metre-space import/export arithmetic can differ by float32 roundoff.
    # One micrometre of numeric precision still requires BOTH edge endpoints
    # to match; this is not a radius search for neighbouring hair strands.
    coordinates = [tuple(round(float(c), 6) for c in point) for point in points]
    grouped = {}
    for a, b in edges:
        if not (0 <= a < count and 0 <= b < count):
            raise ValueError('Invalid topology edge')
        if a not in allowed or b not in allowed or coordinates[a] == coordinates[b]:
            continue
        key = tuple(sorted((coordinates[a], coordinates[b])))
        grouped.setdefault(key, []).append((a, b))
    pairs = set()
    for entries in grouped.values():
        if len(entries) < 2:
            continue
        endpoints = {}
        for edge in entries:
            for index in edge:
                endpoints.setdefault(coordinates[index], set()).add(index)
        for indices in endpoints.values():
            ordered = sorted(indices)
            pairs.update((ordered[0], index) for index in ordered[1:])
    return sorted(pairs)


def validate_uv_seam_pairs(points, edges, pairs):
    """Reject links that cannot be verified against the preserved source mesh."""
    parents = list(range(len(points)))
    def representative(index):
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index
    for a,b in uv_seam_pairs(points, edges):
        parents[representative(b)] = representative(a)
    validated = [];seen = set()
    for pair in pairs:
        if not isinstance(pair, (list, tuple)) or len(pair) != 2 or any(type(i) is not int for i in pair):
            raise ValueError('Invalid reviewed UV seam link')
        item = tuple(sorted(pair))
        a,b=item
        if not (0 <= a < len(points) and 0 <= b < len(points)) or a == b or representative(a) != representative(b) or item in seen:
            raise ValueError('UV seam link must belong to an identical source edge')
        validated.append(item);seen.add(item)
    return validated


def validate_seam_motion(points, edges, weights, displacement):
    """Fail before applying a movement that would open a duplicate source edge.

    This does not add links, weld vertices, or change the reviewed selection.
    The importer calls it on the approved source too, so an omitted seam cannot
    silently pass just because the recorded Connected Only operation replays.
    """
    if len(displacement) != 3 or not all(math.isfinite(v) for v in displacement):
        raise ValueError('Finite three-dimensional displacement required')
    length = math.sqrt(sum(v*v for v in displacement))
    for a, b in uv_seam_pairs(points, edges):
        difference = abs(weights.get(a, 0) - weights.get(b, 0)) * length
        if difference > 1e-6:
            raise ValueError('Movement would open a UV seam; review duplicate edges and include their copies before deforming')


def connected_weights(points, edges, seeds, radius, allowed=None, seam_pairs=()):
    """Graph distances, not world proximity. Optional UV seam links must be reviewed.

    No vertex welding or topology changes. An unconnected nearby strand has zero
    influence. Reject clipped masks instead of introducing a hard deformation edge.
    """
    if not math.isfinite(radius) or radius <= 0:
        raise ValueError('Positive finite influence radius required')
    count = len(points)
    allowed = set(range(count)) if allowed is None else set(allowed)
    seeds = set(seeds)
    if not seeds or not seeds <= allowed or any(i < 0 or i >= count for i in allowed):
        raise ValueError('Seeds must belong to the reviewed hair region')
    graph = [[] for _ in points]
    boundary = set()
    for a, b in list(edges) + list(seam_pairs):
        if not (0 <= a < count and 0 <= b < count):
            raise ValueError('Invalid topology edge')
        if a in allowed and b in allowed:
            distance = math.dist(points[a], points[b])
            graph[a].append((b, distance)); graph[b].append((a, distance))
        elif a in allowed or b in allowed:
            boundary.add(a if a in allowed else b)
    distances = {i: 0.0 for i in seeds}
    queue = [(0.0, i) for i in seeds]
    heapq.heapify(queue)
    while queue:
        distance, i = heapq.heappop(queue)
        if distance != distances[i]:
            continue
        for j, length in graph[i]:
            candidate = distance + length
            if candidate < radius and candidate < distances.get(j, math.inf):
                distances[j] = candidate
                heapq.heappush(queue, (candidate, j))
    weights = {i: 1 - (d/radius)**2 * (3 - 2*d/radius) for i, d in distances.items()}
    if any(weights.get(i, 0) > .001 for i in boundary):
        raise ValueError('Reviewed region cuts an active influence; expand the region or reduce the radius')
    return weights
