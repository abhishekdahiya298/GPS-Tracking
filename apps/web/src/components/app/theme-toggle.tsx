"use client";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { THEME_COOKIE, applyTheme, readTheme, type ThemeChoice } from "@/lib/theme";

const CHOICES: ReadonlyArray<{ value: ThemeChoice; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "Same as this computer", icon: Monitor }
];

function currentChoice(): ThemeChoice {
  const m = document.cookie.match(new RegExp(`(?:^|; )${THEME_COOKIE}=([^;]*)`));
  return readTheme(m?.[1]);
}

/** Top bar: sun / moon button to switch light and dark (same setting as My account → Appearance). */
export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>("light");
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const sync = () => {
      const c = currentChoice();
      setChoice(c);
      setDark(c === "dark" || (c === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches));
    };
    sync();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  const pick = (c: ThemeChoice) => {
    applyTheme(c);
    setChoice(c);
    setDark(c === "dark" || (c === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches));
  };
  const Icon = dark ? Moon : Sun;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Colour mode: ${dark ? "dark" : "light"}. Change`} title="Light or dark">
          <Icon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-52">
        {CHOICES.map((c) => (
          <DropdownMenuItem key={c.value} onSelect={() => pick(c.value)}>
            <c.icon aria-hidden="true" />
            <span className="flex-1">{c.label}</span>
            {choice === c.value && <Check className="text-primary" aria-hidden="true" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
