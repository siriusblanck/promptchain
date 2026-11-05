// Templates remount on every navigation (layouts don't), so each page gets an entrance animation.
export default function ToolTemplate({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
