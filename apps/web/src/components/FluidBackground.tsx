/** Slow-moving colour blobs behind frosted-glass surfaces. Pure CSS; respects reduced motion. */
export function FluidBackground() {
  return (
    <div className="fluid-bg" aria-hidden="true">
      <span className="blob b1" />
      <span className="blob b2" />
      <span className="blob b3" />
      <span className="blob b4" />
      <span className="grain" />
    </div>
  );
}
