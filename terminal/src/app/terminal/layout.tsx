import { Rail } from "@/components/Live";

export default function TerminalLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="app">
      <Rail />
      <main className="main">{children}</main>
    </div>
  );
}
