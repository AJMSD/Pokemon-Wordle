import React from 'react'

interface DefaultAvatarProps {
  size?: number
}

// 16x16 head-and-shoulders of Red, the Kanto trainer, in a Game Boy Color
// palette. Each character is one pixel; '.' is background.
const PIXELS = [
  '................',
  '.....KKKKKK.....',
  '....KRWWWWRK....',
  '...KRWWWWWWRK...',
  '...KRRWWWWRRK...',
  '..KKRRRRRRRRKK..',
  '.KRRRRRRRRRRRRK.',
  '..KHHKKKKKKHHK..',
  '..KHSSSSSSSSHK..',
  '...KSKSSSSKSK...',
  '...KSKSSSSKSK...',
  '....KSSPPSSK....',
  '..KKWKKSSKKWKK..',
  '.KWWRRRKKRRRWWK.',
  '.KWWRRRKKRRRWWK.',
  'KWWWRRRKKRRRWWWK',
]

const BACKGROUND = '#fae2d6'

const COLORS: Record<string, string> = {
  K: '#181010', // outline, shirt
  R: '#d81818', // cap, jacket
  W: '#f8f8f8', // cap front, sleeves
  S: '#f8c8a0', // skin
  H: '#382828', // hair
  P: '#e88878', // mouth
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
      aria-label="Default trainer avatar (Red)"
    >
      <rect width="16" height="16" fill={BACKGROUND} />
      {RUNS.map(run => (
        <rect key={`${run.x}-${run.y}`} x={run.x} y={run.y} width={run.w} height={1} fill={run.fill} />
      ))}
    </svg>
  )
}

export default DefaultAvatar
