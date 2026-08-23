import React from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";

const SCENE_ASSETS = {
  sidebar: { asset: "shinchan-sidebar-clean.png", width: 254, height: 339 },
  friends: { asset: "shinchan-friends-clean.png", width: 170, height: 164 },
  head: { asset: "shinchan-head-clean.png", width: 92, height: 101 },
  standing: { asset: "shinchan-standing-clean.png", width: 98, height: 164 },
  shiro: { asset: "shiro-clean.png", width: 102, height: 124 },
  assistant: { asset: "assistant-toys-clean.png", width: 500, height: 96 },
  calendar: { asset: "calendar-school-clean.png", width: 244, height: 70 },
  todos: { asset: "todo-box.webp", width: 175, height: 175 },
  notes: { asset: "notes-desk.webp", width: 165, height: 180 },
  documents: { asset: "documents-explorer.webp", width: 205, height: 258 },
  settings: { asset: "settings-wave.webp", width: 128, height: 143 },
} as const;

export type CrayonScene = keyof typeof SCENE_ASSETS;

export function CrayonDecoration({
  scene,
  className,
}: {
  scene: CrayonScene;
  className?: string;
}) {
  const { asset, width, height } = SCENE_ASSETS[scene];

  return (
    <Image
      src={`/crayon/${asset}`}
      width={width}
      height={height}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn("pointer-events-none select-none object-contain", className)}
    />
  );
}
