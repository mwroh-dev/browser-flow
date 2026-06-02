export function selectReusablePrefix({ segments }) {
  let reusedUntilSegment = -1;
  for (const [position, segment] of segments.entries()) {
    const index = segment.index ?? position;
    if (segment.reusable !== true) {
      return {
        reusedUntilSegment,
        gapStartsAtSegment: index
      };
    }
    reusedUntilSegment = index;
  }
  return {
    reusedUntilSegment,
    gapStartsAtSegment: null
  };
}
