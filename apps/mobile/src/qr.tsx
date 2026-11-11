import qrcode from 'qrcode-generator';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

const QUIET_ZONE = 4;

/** The dark squares of a QR code as one path, which draws far faster than one shape per square. */
const qrShape = (text: string) => {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  let path = '';
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      if (qr.isDark(row, column)) path += `M${column} ${row}h1v1h-1z`;
    }
  }
  return { path, count };
};

/** For the printed sheet. */
export const qrSvg = (text: string) => {
  const { path, count } = qrShape(text);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-QUIET_ZONE} ${-QUIET_ZONE} ${count + QUIET_ZONE * 2} ${count + QUIET_ZONE * 2}"><path d="${path}" fill="#000"/></svg>`;
};

/** Black on white whatever the theme: scanners struggle with a light-on-dark code. */
export function QrCode({ value, size = 120 }: { value: string; size?: number }) {
  const { path, count } = qrShape(value);
  return (
    <View accessibilityLabel="QR code" style={{ width: size, height: size, backgroundColor: '#fff' }}>
      <Svg width={size} height={size} viewBox={`${-QUIET_ZONE} ${-QUIET_ZONE} ${count + QUIET_ZONE * 2} ${count + QUIET_ZONE * 2}`}>
        <Path d={path} fill="#000" />
      </Svg>
    </View>
  );
}
