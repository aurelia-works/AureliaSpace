import { create } from "zustand";
import { ipc, type Config } from "../lib/ipc";

interface ConfigState {
  config: Config | null;
  load(): Promise<Config>;
  save(config: Config): Promise<void>;
}

export const useConfig = create<ConfigState>((set) => ({
  config: null,
  async load() {
    const config = await ipc.getConfig();
    set({ config });
    return config;
  },
  async save(config) {
    await ipc.saveConfig(config);
    set({ config });
  },
}));

export const getConfig = (): Config => {
  const c = useConfig.getState().config;
  if (!c) throw new Error("config not loaded");
  return c;
};
