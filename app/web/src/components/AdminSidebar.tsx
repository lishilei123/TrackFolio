import type { ReactNode } from "react";
import { Segmented } from "./Segmented";

export interface AdminNavItem<T extends string> {
  key: T;
  label: string;
  desc?: string;
  icon: ReactNode;
}

/**
 * 后台分区导航：桌面（lg+）为左侧竖向菜单，窄屏降级为顶部横向分段控件（复用 Segmented）。
 * 纯展示组件，不含业务逻辑；激活态样式见 index.css 的 .admin-nav-item。
 */
export function AdminSidebar<T extends string>({
  items,
  active,
  onSelect,
}: {
  items: Array<AdminNavItem<T>>;
  active: T;
  onSelect: (key: T) => void;
}) {
  return (
    <div className="lg:sticky lg:top-[76px]">
      {/* 窄屏：顶部横向分段导航 */}
      <div className="lg:hidden">
        <Segmented options={items.map((i) => [i.key, i.label] as [T, string])} value={active} onChange={onSelect} />
      </div>

      {/* 桌面：竖向菜单 */}
      <nav aria-label="后台分区" className="hidden lg:flex lg:flex-col lg:gap-1">
        {items.map((item) => {
          const isActive = item.key === active;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onSelect(item.key)}
              aria-current={isActive ? "page" : undefined}
              className={`admin-nav-item ${isActive ? "is-active" : ""}`}
            >
              <span className="admin-nav-icon" aria-hidden>
                {item.icon}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-medium leading-5">{item.label}</span>
                {item.desc && <span className="truncate text-[11px] leading-4 opacity-70">{item.desc}</span>}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
