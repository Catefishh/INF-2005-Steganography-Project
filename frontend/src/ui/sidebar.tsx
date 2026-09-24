import { createContext, useContext, useState, type AnchorHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { motion } from "motion/react";

const SidebarContext = createContext<{ expanded: boolean; toggle: () => void } | null>(null);

function useSidebar() {
  const value = useContext(SidebarContext);
  if (!value) throw new Error("Sidebar components require SidebarProvider");
  return value;
}

/** Locally owned, plain-CSS adaptation of the shadcn sidebar composition. */
export function SidebarProvider({ children }: { children: ReactNode }) {
  const [expanded, setExpanded] = useState(true);
  return <SidebarContext.Provider value={{ expanded, toggle: () => setExpanded((value) => !value) }}>
    <div className={`app sidebar-layout${expanded ? "" : " sidebar-collapsed"}`}>{children}</div>
  </SidebarContext.Provider>;
}

export function Sidebar({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <motion.aside className={`rail sidebar ${className}`} layout="position" transition={{ duration: 0.2 }}>{children}</motion.aside>;
}

export function SidebarInset({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <main className={`main sidebar-inset ${className}`}>{children}</main>;
}

export function SidebarTrigger({ children }: { children: ReactNode }) {
  const { expanded, toggle } = useSidebar();
  return <button type="button" className="sidebar-trigger" aria-controls="rail-nav"
    aria-expanded={expanded} aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
    title={expanded ? "Collapse sidebar" : "Expand sidebar"} onClick={toggle}>{children}</button>;
}

export function SidebarMenu({ children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className="sidebar-menu" {...props}>{children}</div>;
}

export function SidebarMenuItem({ children, className = "", ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a className={`sidebar-menu-item ${className}`} {...props}>{children}</a>;
}
