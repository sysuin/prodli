// Time Tracker: the history the extension tracked on your computers (synced; phones don't track).
import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { getDayKey } from "@/shared";
import { TRACKING_KEY } from "@/lib/sync";
import { totals } from "@/lib/tracker";
import { useStored } from "@/lib/store";
import { Card, Chip, Empty, P, Row, Screen } from "@/ui/kit";
import { font, useTheme } from "@/ui/theme";

const fmt = (sec: number) => {
  const m = Math.round(sec / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

export default function TrackerScreen() {
  const t = useTheme();
  const tracking = useStored<Record<string, Record<string, number>>>(TRACKING_KEY, {});
  const [range, setRange] = useState<1 | 7 | 30>(1);
  const days = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i < range; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      out.push(getDayKey(d));
    }
    return out;
  }, [range]);
  const rows = useMemo(() => totals(tracking, days), [tracking, days]);
  const total = rows.reduce((n, [, s]) => n + s, 0);
  const max = rows[0]?.[1] ?? 1;
  return (
    <Screen edges={[]}>
      <Row>
        <Chip label="Today" active={range === 1} onPress={() => setRange(1)} />
        <Chip label="7 days" active={range === 7} onPress={() => setRange(7)} />
        <Chip label="30 days" active={range === 30} onPress={() => setRange(30)} />
      </Row>
      {rows.length ? (
        <>
          <P>
            <Text style={{ fontWeight: "900" }}>{fmt(total)}</Text> on {rows.length} site{rows.length === 1 ? "" : "s"}
          </P>
          <Card>
            {rows.slice(0, 25).map(([site, s]) => (
              <View key={site} style={{ gap: 3 }} accessibilityLabel={`${site}: ${fmt(s)}`}>
                <Row style={{ justifyContent: "space-between" }}>
                  <Text numberOfLines={1} style={{ flex: 1, color: t.fg, fontWeight: "700", fontSize: font.small }}>{site}</Text>
                  <Text style={{ color: t.mutedFg, fontSize: font.small }}>{fmt(s)}</Text>
                </Row>
                <View style={{ height: 8, backgroundColor: t.muted, borderWidth: 1, borderColor: t.border }}>
                  <View style={{ height: "100%", width: `${Math.max(2, (s / max) * 100)}%`, backgroundColor: t.secondary }} />
                </View>
              </View>
            ))}
          </Card>
        </>
      ) : (
        <Empty icon="stats-chart-outline" title="Nothing tracked" hint="The ProdLi extension tracks time on websites on your computer. Sign in on both to see it here." />
      )}
    </Screen>
  );
}
