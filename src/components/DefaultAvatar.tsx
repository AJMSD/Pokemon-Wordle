import React from 'react'

interface DefaultAvatarProps {
  size?: number
}

// 16x16 pixel trainer. Each character is one pixel; '.' is background.
const PIXELS = [
  '................',
  '.....RRRRRR.....',
  '....RRRWWRRR....',
  '....RRRRRRRR....',
  '...RRRRRRRRRRR..',
  '....HSSSSSSH....',
  '....SSKSSKSS....',
  '....SSSSSSSS....',
  '.....SSSSSS.....',
  '......SSSS......',
  '....RRRWWRRR....',
  '...RRRRWWRRRR...',
  '...RRRRWWRRRR...',
  '...RRRRWWRRRR...',
  '...RRRRRRRRRR...',
  '................',
]

const COLORS: Record<string, string> = {
  R: '#cc0000',
  W: '#ffffff',
  S: '#e8c49a',
  K: '#1a1a2e',
  H: '#4a2c17',
}

// Merge horizontal runs of the same colour into single rects.
const RUNS = PIXELS.flatMap((row, y) => {
  const runs: { x: number; y: number; w: number; fill: string }[] = []
  for (let x = 0; x < row.length; x++) {
    const fill = COLORS[row[x]]
    if (!fill) continue
    const last = runs[runs.length - 1]
    if (last && last.fill === fill && last.x + last.w === x) last.w += 1
    else runs.push({ x, y, w: 1, fill })
  }
  return runs
})

const DefaultAvatar: React.FC<DefaultAvatarProps> = ({ size = 64 }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
      shapeRendering="crispEdges"
      role="img"
      aria-label="Default trainer avatar"
    >
      <rect width="16" height="16" fill="#1a1a2e" />
      {RUNS.map(run => (
        <rect key={`${run.x}-${run.y}`} x={run.x} y={run.y} width={run.w} height={1} fill={run.fill} />
      ))}
    </svg>
  )
}

export default DefaultAvatar
