import type { ComponentType } from "react";
import type { Config } from "../../lib/ipc";
import { AccountsSection } from "./AccountsSection";
import { AgentsSection } from "./AgentsSection";
import { AppearanceSection } from "./AppearanceSection";
import { GeneralSection } from "./GeneralSection";
import { HudSection } from "./HudSection";
import { IntegrationsSection } from "./IntegrationsSection";
import { ShortcutsSection } from "./ShortcutsSection";
import { SuggestionsSection } from "./SuggestionsSection";
import { VoiceSection } from "./VoiceSection";

/** Props every section receives. `draft` is the unsaved config; mutate it via `update`. */
export interface SectionProps {
  draft: Config;
  update(fn: (c: Config) => void): void;
  /** Status line in the page footer. */
  notify(msg: string): void;
}

export interface SettingsSection {
  id: string;
  label: string;
  Component: ComponentType<SectionProps>;
}

/** Adding a settings section = one entry here plus its component file. */
export const SECTIONS: SettingsSection[] = [
  { id: "general", label: "General", Component: GeneralSection },
  { id: "appearance", label: "Appearance", Component: AppearanceSection },
  { id: "accounts", label: "Accounts", Component: AccountsSection },
  { id: "agents", label: "Agents", Component: AgentsSection },
  { id: "suggestions", label: "Suggestions", Component: SuggestionsSection },
  { id: "voice", label: "Voice", Component: VoiceSection },
  { id: "hud", label: "HUD", Component: HudSection },
  { id: "integrations", label: "Integrations", Component: IntegrationsSection },
  { id: "shortcuts", label: "Shortcuts", Component: ShortcutsSection },
];
