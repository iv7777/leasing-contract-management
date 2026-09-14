import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { defaultTopicForPath } from "./registry";

interface HelpContextValue {
  topic: string;
  setTopic: (topic: string) => void;
}

const HelpContext = createContext<HelpContextValue | null>(null);

export function HelpProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [topic, setTopic] = useState(() => defaultTopicForPath(location.pathname));

  useEffect(() => {
    setTopic(defaultTopicForPath(location.pathname));
  }, [location.pathname]);

  return <HelpContext.Provider value={{ topic, setTopic }}>{children}</HelpContext.Provider>;
}

export function useHelp() {
  const ctx = useContext(HelpContext);
  if (!ctx) throw new Error("useHelp must be used within a HelpProvider");
  return ctx;
}

/**
 * Lets a page with internal tabs/sections narrow the help topic beyond the
 * route default (e.g. a specific tab on the Contract Detail page). Falls
 * back to the route default automatically when the page unmounts or the
 * section changes back to undefined.
 */
export function useHelpTopic(topic: string | undefined) {
  const { setTopic } = useHelp();
  const location = useLocation();

  useEffect(() => {
    setTopic(topic ?? defaultTopicForPath(location.pathname));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic]);
}
