import { ActivityIndicator, StyleSheet, Switch, Text, View } from 'react-native';

import { scanText } from '../ai/scan-text';
import type { useSmartSettings } from '../ai/smart-settings';
import type { People } from '../people/use-people';
import type { SearchIndex } from '../search/use-search-index';
import { Button, Note } from '../ui/kit';
import { Row } from '../ui/rows';
import type { Palette } from '../ui/theme';

/** What Settings needs to show and change the smart features. */
export interface Smart {
  settings: ReturnType<typeof useSmartSettings>;
  people: Pick<People, 'scan' | 'lookedAt' | 'downloadNow' | 'retryScan'>;
  index: Pick<SearchIndex, 'scan' | 'lookedAt' | 'downloadNow' | 'retryScan'>;
}

function Feature({
  title,
  detail,
  on,
  onChange,
  progress,
  palette,
}: {
  title: string;
  detail: string;
  on: boolean;
  onChange: (on: boolean) => void;
  progress: Smart['index'];
  palette: Palette;
}) {
  const { scan } = progress;
  return (
    <>
      <Row
        title={title}
        detail={detail}
        palette={palette}
        action={
          <Switch
            accessibilityLabel={title}
            value={on}
            trackColor={{ true: palette.accent, false: palette.track }}
            thumbColor={palette.surface}
            onValueChange={onChange}
          />
        }
      />
      <View style={styles.status}>
        <View style={styles.line}>
          {scan.state === 'scanning' || scan.state === 'downloading' ? (
            <ActivityIndicator color={palette.accent} size="small" />
          ) : null}
          {scan.state === 'failed' ? (
            <View style={styles.grow}>
              <Note error>{scanText(scan, progress.lookedAt)}</Note>
            </View>
          ) : (
            <Text style={[styles.text, { color: palette.muted }]}>
              {scanText(scan, progress.lookedAt)}
            </Text>
          )}
        </View>
        {scan.state === 'waiting-for-wifi' ? (
          <Button kind="secondary" label="Download now" onPress={progress.downloadNow} />
        ) : null}
        {scan.state === 'failed' ? (
          <Button kind="secondary" label="Try again" onPress={progress.retryScan} />
        ) : null}
      </View>
    </>
  );
}

/**
 * Settings for the smart features on this phone: finding faces for People, and looking at
 * what photos show for Smart search. Both run on the phone, only while Arcafold is open.
 */
export function SmartSettings({ smart, palette }: { smart: Smart; palette: Palette }) {
  const { settings } = smart;
  if (!settings.loaded) {
    return (
      <View style={styles.status}>
        <ActivityIndicator color={palette.accent} />
      </View>
    );
  }
  return (
    <>
      <Feature
        title="Face grouping"
        detail="Finds faces in your photos on this phone and groups them into People. Faces never leave your devices unencrypted."
        on={settings.faces}
        onChange={settings.setFaces}
        progress={smart.people}
        palette={palette}
      />
      <Feature
        title="Smart search"
        detail="Looks at what your photos show on this phone, so you can search for things like “beach”. It all stays encrypted."
        on={settings.search}
        onChange={settings.setSearch}
        progress={smart.index}
        palette={palette}
      />
    </>
  );
}

const styles = StyleSheet.create({
  status: { paddingHorizontal: 16, paddingBottom: 14, gap: 10 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grow: { flex: 1 },
  text: { flex: 1, fontSize: 13, lineHeight: 18 },
});
