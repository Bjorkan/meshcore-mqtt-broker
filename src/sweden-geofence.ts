import swedenBoundary from "./sweden-boundary.json" with { type: "json" };

type Position = [number, number];
type Ring = Position[];
type Polygon = Ring[];

const polygons = swedenBoundary.coordinates as Polygon[];
const SWEDEN_BOUNDS = {
  west: 10.8,
  south: 55.2,
  east: 24.3,
  north: 69.2,
};

function isPointOnSegment(
  point: Position,
  start: Position,
  end: Position,
): boolean {
  const cross =
    (point[1] - start[1]) * (end[0] - start[0]) -
    (point[0] - start[0]) * (end[1] - start[1]);
  if (Math.abs(cross) > 1e-10) return false;
  return (
    point[0] >= Math.min(start[0], end[0]) &&
    point[0] <= Math.max(start[0], end[0]) &&
    point[1] >= Math.min(start[1], end[1]) &&
    point[1] <= Math.max(start[1], end[1])
  );
}

function isPointInRing(point: Position, ring: Ring): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length;) {
    const start = ring[previous];
    const end = ring[index];
    if (isPointOnSegment(point, start, end)) return true;
    if (
      start[1] > point[1] !== end[1] > point[1] &&
      point[0] <
        ((end[0] - start[0]) * (point[1] - start[1])) / (end[1] - start[1]) +
          start[0]
    ) {
      inside = !inside;
    }
    previous = index;
    index += 1;
  }
  return inside;
}

export function isPointInSweden(latitude: number, longitude: number): boolean {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    longitude < SWEDEN_BOUNDS.west ||
    longitude > SWEDEN_BOUNDS.east ||
    latitude < SWEDEN_BOUNDS.south ||
    latitude > SWEDEN_BOUNDS.north
  ) {
    return false;
  }

  const point: Position = [longitude, latitude];
  return polygons.some(
    ([outer, ...holes]) =>
      isPointInRing(point, outer) &&
      !holes.some((hole) => isPointInRing(point, hole)),
  );
}
