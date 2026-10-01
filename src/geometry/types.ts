/**
 * Coordinate and sign conventions (public contract).
 *
 * Body frame, fixed to the hull, x axis points to STARBOARD (right),
 * z axis points UP, units are metres. The section is a closed convex
 * polygon that is constant along the whole hull length L (prismatic hull,
 * no trim). The water surface is a horizontal line z_w in body frame
 * coordinates: water occupies z <= z_w.
 *
 * Heel angle phi (degrees): positive means the hull rotates
 * COUNTER-CLOCKWISE in the (x, z) plane, i.e. the starboard side
 * (positive x) rises and the port side (negative x) submerges.
 * Rotation of a body-frame vector into world frame uses
 *   x_w =  x*cos(phi) - z*sin(phi)
 *   z_w =  x*sin(phi) + z*cos(phi)
 * Equivalently, to build the world-frame section at heel phi we rotate
 * every body vertex by +phi. The center of gravity is a body point and is
 * rotated together with the hull; it is never left fixed in world space.
 *
 * Righting arm GZ = x_B(world) - x_G(world). With positive phi defined as
 * starboard-up, a hull that pushes back upright develops buoyancy on the
 * submerged port side, giving the center of buoyancy a NEGATIVE world x,
 * hence GZ < 0 for a stable configuration at phi > 0. The RESTORING
 * moment about the body longitudinal axis is M = -rho*g*V*GZ, so stable
 * means phi * GZ < 0 (restoring moment opposite to heel).
 *
 * Draft d: vertical distance from the lowest point of the (rotated)
 * section to the waterline, d = z_w - min(z_world of vertices), d >= 0.
 */

export interface Point {
  x: number;
  z: number;
}

export interface SectionSnapshot {
  /** Vertices in body frame, closed implicitly (last -> first). */
  vertices: Point[];
  geometryVersion: number;
}

export interface PolygonResult {
  area: number;
  centroid: Point;
  polygon: Point[];
}

export interface MassParams {
  length: number;
  mass: number;
  cg: Point;
  density: number;
  gravitationalAcceleration: number;
}
