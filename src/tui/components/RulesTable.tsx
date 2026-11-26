import { directionArrow, portsLabel, protocolLabel } from "../../engine/resolver.ts";
import type { Direction, Protocol, TabId } from "../../types/model.ts";
import { directionColor, padCell, protocolColor, THEME } from "../theme.ts";

export interface TableRow {
  id: string;
  sourceKey?: string;
  sourceLabel: string;
  targetLabel: string;
  direction: Direction;
  protocol: Protocol;
  ports: string[];
  originLabel?: string;
  hasConflict?: boolean;
  isProtected?: boolean;
}

export type DisplayTableItem =
  | {
      kind: "single";
      id: string;
      row: TableRow;
    }
  | {
      kind: "group_header";
      id: string;
      sourceKey: string;
      sourceLabel: string;
      count: number;
      expanded: boolean;
      hasConflict: boolean;
      isProtected: boolean;
      previewTargets: string;
      rows: TableRow[];
    }
  | {
      kind: "group_child";
      id: string;
      sourceKey: string;
      isLast: boolean;
      row: TableRow;
    };

/**
 * Groups table rows by the same origin (sourceKey / sourceLabel).
 * Origins with 2+ destinations render as a collapsible dropdown group;
 * origins with a single destination render directly for quick scanning/editing.
 */
export function buildDisplayTableItems(
  rows: TableRow[],
  expandedGroups: Set<string>,
  grouped: boolean,
  forceExpandAll = false
): DisplayTableItem[] {
  if (!grouped) {
    return rows.map((row) => ({ kind: "single", id: row.id, row }));
  }

  const groups = new Map<string, TableRow[]>();
  for (const row of rows) {
    const key = row.sourceKey ?? row.sourceLabel;
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = [];
      groups.set(key, bucket);
    }
    bucket.push(row);
  }

  const items: DisplayTableItem[] = [];
  for (const [sourceKey, groupRows] of groups.entries()) {
    if (groupRows.length === 1) {
      const singleRow = groupRows[0]!;
      items.push({ kind: "single", id: singleRow.id, row: singleRow });
      continue;
    }

    const first = groupRows[0]!;
    const expanded = forceExpandAll || expandedGroups.has(sourceKey);
    const previewNames = groupRows
      .slice(0, 3)
      .map((r) => r.targetLabel)
      .join(", ");
    const previewTargets =
      groupRows.length > 3
        ? `${groupRows.length} destinos (${previewNames}…)`
        : `${groupRows.length} destinos (${previewNames})`;

    items.push({
      kind: "group_header",
      id: `group:${sourceKey}`,
      sourceKey,
      sourceLabel: first.sourceLabel,
      count: groupRows.length,
      expanded,
      hasConflict: groupRows.some((r) => r.hasConflict),
      isProtected: groupRows.some((r) => r.isProtected),
      previewTargets,
      rows: groupRows,
    });

    if (expanded) {
      groupRows.forEach((row, idx) => {
        items.push({
          kind: "group_child",
          id: row.id,
          sourceKey,
          isLast: idx === groupRows.length - 1,
          row,
        });
      });
    }
  }

  return items;
}

export interface RulesTableProps {
  tab: TabId;
  items: DisplayTableItem[];
  selectedIndex: number;
  viewportHeight: number;
  filterQuery: string;
  emptyHint: string;
}

export function RulesTable({
  tab,
  items,
  selectedIndex,
  viewportHeight,
  filterQuery,
  emptyHint,
}: RulesTableProps) {
  const showOrigin = tab === "direct";
  const safeHeight = Math.max(5, viewportHeight);

  // Compute scroll window so selected item stays in view
  let startIdx = 0;
  if (items.length > safeHeight) {
    const half = Math.floor(safeHeight / 2);
    startIdx = Math.max(0, Math.min(selectedIndex - half, items.length - safeHeight));
  }
  const visibleItems = items.slice(startIdx, startIdx + safeHeight);

  const srcWidth = 22;
  const dirWidth = 7;
  const dstWidth = 24;
  const protoWidth = 9;
  const portsWidth = showOrigin ? 15 : 22;
  const originWidth = 24;

  return (
    <box flexDirection="column" flexGrow={1} paddingX={1} paddingY={0}>
      {/* Filter indicator */}
      {filterQuery ? (
        <box paddingBottom={0}>
          <text fg={THEME.yellow}>{`Filtro activo: "${filterQuery}"  (Esc para limpiar)`}</text>
        </box>
      ) : null}

      {/* Header row */}
      <box
        flexDirection="row"
        paddingX={1}
        backgroundColor={THEME.surfaceAlt}
        border={["bottom"]}
        borderColor={THEME.border}
      >
        <text fg={THEME.subtext}>
          <b>
            {"  "}
            {padCell("Origen", srcWidth)}
            {padCell("Dir", dirWidth)}
            {padCell("Destino", dstWidth)}
            {padCell("Proto", protoWidth)}
            {padCell("Puertos", portsWidth)}
            {showOrigin ? padCell("Regla activa", originWidth) : ""}
          </b>
        </text>
      </box>

      {/* Body rows */}
      {items.length === 0 ? (
        <box
          flexGrow={1}
          flexDirection="column"
          justifyContent="center"
          alignItems="center"
          padding={2}
        >
          <text fg={THEME.muted}>{emptyHint}</text>
        </box>
      ) : (
        <box flexDirection="column" flexGrow={1}>
          {visibleItems.map((item, idx) => {
            const actualIndex = startIdx + idx;
            const isSelected = actualIndex === selectedIndex;
            const rowBg = isSelected ? THEME.selectedBg : THEME.bg;

            if (item.kind === "group_header") {
              const caret = item.expanded ? "▾" : "▸";
              const shield = item.isProtected ? "🛡 " : "";
              const groupLabel = `${caret} ${shield}${item.sourceLabel} (${item.count})`;

              return (
                <box
                  key={item.id}
                  flexDirection="row"
                  paddingX={1}
                  backgroundColor={rowBg}
                >
                  <text fg={isSelected ? THEME.accent : THEME.muted}>
                    {isSelected ? "▸ " : "  "}
                  </text>
                  <text fg={isSelected ? THEME.accent : THEME.cyan}>
                    <b>{padCell(groupLabel, srcWidth)}</b>
                  </text>
                  <text fg={THEME.muted}>
                    {padCell(item.expanded ? "  ▾  " : "  ▸  ", dirWidth)}
                  </text>
                  <text fg={item.expanded ? THEME.subtext : THEME.text} truncate>
                    {padCell(
                      item.previewTargets,
                      dstWidth + protoWidth + portsWidth + (showOrigin ? originWidth : 0)
                    )}
                  </text>
                </box>
              );
            }

            const row = item.row;
            const arrow = directionArrow(row.direction);
            const dirText = `  ${arrow}  `;
            const isChild = item.kind === "group_child";
            const branchPrefix = isChild
              ? item.isLast
                ? "  └─ "
                : "  ├─ "
              : "";
            const leftCellText = isChild
              ? branchPrefix
              : row.isProtected
                ? `🛡 ${row.sourceLabel}`
                : row.sourceLabel;

            return (
              <box
                key={item.id}
                flexDirection="row"
                paddingX={1}
                backgroundColor={rowBg}
              >
                <text fg={isSelected ? THEME.accent : THEME.muted}>
                  {isSelected ? "▸ " : "  "}
                </text>
                <text fg={isChild ? THEME.muted : THEME.text}>
                  {padCell(leftCellText, srcWidth)}
                </text>
                <text fg={directionColor(row.direction)}>
                  <b>{padCell(dirText, dirWidth)}</b>
                </text>
                <text fg={THEME.text}>
                  {padCell(
                    isChild && row.isProtected ? `🛡 ${row.targetLabel}` : row.targetLabel,
                    dstWidth
                  )}
                </text>
                <text fg={protocolColor(row.protocol)}>
                  {padCell(protocolLabel(row.protocol), protoWidth)}
                </text>
                <text fg={THEME.subtext}>
                  {padCell(portsLabel(row.ports), portsWidth)}
                </text>
                {showOrigin ? (
                  <text fg={row.hasConflict ? THEME.red : THEME.teal}>
                    {padCell(row.originLabel ?? "", originWidth)}
                  </text>
                ) : null}
              </box>
            );
          })}
        </box>
      )}

      {/* Footer scroll counter */}
      {items.length > safeHeight ? (
        <box paddingX={1} justifyContent="flex-end" flexDirection="row">
          <text fg={THEME.muted}>
            {`Mostrando ${startIdx + 1}-${Math.min(startIdx + safeHeight, items.length)} de ${items.length}`}
          </text>
        </box>
      ) : null}
    </box>
  );
}
