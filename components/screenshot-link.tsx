"use client";

import { useState } from "react";
import { Modal } from "./modal";

/** Link que abre o print num modal (com opção de abrir em nova aba). */
export function ScreenshotLink({
  url,
  label,
  title,
  thumbnail = false,
}: {
  url: string;
  label: string;
  title: string;
  thumbnail?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {thumbnail ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
          className="group block overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-700"
          title={title}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- signed URL externa e temporária */}
          <img
            src={url}
            alt={title}
            className="h-36 w-56 object-cover object-top transition-transform group-hover:scale-105"
            loading="lazy"
          />
          <span className="block bg-zinc-50 px-2 py-1 text-left text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {label}
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
          className="text-xs font-medium text-sky-700 underline-offset-2 hover:underline dark:text-sky-400"
        >
          {label}
        </button>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={title} wide>
        <div className="mb-3 flex justify-end">
          <a href={url} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-xs">
            Abrir em nova aba ↗
          </a>
        </div>
        <div className="max-h-[75vh] overflow-auto rounded border border-zinc-200 dark:border-zinc-700">
          {/* eslint-disable-next-line @next/next/no-img-element -- signed URL externa e temporária */}
          <img src={url} alt={title} className="w-full" />
        </div>
      </Modal>
    </>
  );
}
