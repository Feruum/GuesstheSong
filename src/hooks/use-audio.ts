"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export function useAudio({ url, clipKey, start, duration, enabled = true }: { url: string | null; clipKey: string; start: number; duration: number; enabled?: boolean }) {
  const element = useRef<HTMLAudioElement | null>(null);
  const source = useRef(url); const excerpt = useRef({ start, duration, enabled });
  const [playing, setPlaying] = useState(false); const [loading, setLoading] = useState(false); const [progress, setProgress] = useState(0); const [error, setError] = useState<string | null>(null); const [volume, setVolume] = useState(.7);
  useEffect(() => { source.current = url; excerpt.current = { start, duration, enabled }; }, [url, start, duration, enabled]);
  useEffect(() => {
    const audio = new Audio(); audio.preload = "none"; audio.volume = .7; element.current = audio;
    const reset = requestAnimationFrame(() => { if (element.current === audio) { setPlaying(false); setLoading(false); setProgress(0); setError(null); } });
    const onPlay = () => { setPlaying(true); setLoading(false); setError(null); };
    const onPause = () => { setPlaying(false); setLoading(false); };
    const onWaiting = () => setLoading(true);
    const onError = () => { setPlaying(false); setLoading(false); setError("This clip couldn't play. Your guesses are saved. Try replaying it."); };
    const onTime = () => { const limits = excerpt.current; const value = Math.max(0, audio.currentTime - limits.start); setProgress(Math.min(value / limits.duration, 1)); if (value >= limits.duration || !limits.enabled) audio.pause(); };
    audio.addEventListener("playing", onPlay); audio.addEventListener("pause", onPause); audio.addEventListener("waiting", onWaiting); audio.addEventListener("error", onError); audio.addEventListener("timeupdate", onTime);
    const watch = window.setInterval(onTime, 40);
    return () => { cancelAnimationFrame(reset); clearInterval(watch); audio.pause(); audio.removeEventListener("playing", onPlay); audio.removeEventListener("pause", onPause); audio.removeEventListener("waiting", onWaiting); audio.removeEventListener("error", onError); audio.removeEventListener("timeupdate", onTime); audio.removeAttribute("src"); audio.load(); element.current = null; };
  }, [clipKey]);
  useEffect(() => { if (element.current) element.current.volume = volume; }, [volume, clipKey]);
  useEffect(() => { if (!enabled) element.current?.pause(); }, [enabled]);
  const play = useCallback(async () => {
    const audio = element.current; const limits = excerpt.current;
    if (!audio || !source.current || !limits.enabled) return;
    setLoading(true); setError(null); setProgress(0);
    try {
      if (!audio.getAttribute("src") || audio.error) { audio.src = source.current; audio.load(); }
      audio.currentTime = limits.start; await audio.play();
    } catch { if (element.current === audio) { setLoading(false); setPlaying(false); setError("Playback didn't start. Check your connection and try replaying the clip."); } }
  }, []);
  const pause = useCallback(() => element.current?.pause(), []);
  const toggle = useCallback(() => { if (element.current && !element.current.paused) pause(); else void play(); }, [play, pause]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => { const target = event.target as HTMLElement | null; if (event.code === "Space" && !event.repeat && enabled && !target?.closest("input,textarea,select,button,a,[role=combobox],[role=slider],[contenteditable=true],[role=dialog]")) { event.preventDefault(); toggle(); } };
    window.addEventListener("keydown", keyboard); return () => window.removeEventListener("keydown", keyboard);
  }, [toggle, enabled]);
  return { playing, loading, progress, error, volume, setVolume, play, pause, toggle };
}
