import { Slot } from "expo-router";

// Single-screen layout — no tabs, no bottom nav.
// AppBar + settings are handled inside index.tsx.
export default function Layout() {
  return <Slot />;
}
