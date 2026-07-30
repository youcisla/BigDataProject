"use client";

import dynamic from "next/dynamic";

const ReactWordcloud = dynamic(() => import("react-wordcloud"), { ssr: false });

interface Props {
  words: { text: string; value: number }[];
  width?: number;
  height?: number;
}

export function WordCloud({ words, height = 320 }: Props) {
  if (words.length === 0) {
    return (
      <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
        No headlines to summarize yet.
      </div>
    );
  }
  return (
    <div style={{ height }}>
      <ReactWordcloud words={words} options={{
        rotations: 2,
        rotationAngles: [-30, 30],
        fontSizes: [12, 48],
        padding: 2,
      }} />
    </div>
  );
}
