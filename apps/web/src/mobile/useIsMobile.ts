import { useMediaQuery } from "@mui/material";

//  手机断点说明（按 CSS 像素宽度，竖屏 portrait）：
//  iPhone SE / 12 mini: 375 · iPhone 12/13/14/15: 390 · iPhone 15 Pro: 393
//  iPhone Pro Max: 414 / 430 · Android 紧凑: 360 · Pixel 6/7: 412
//  因此竖屏手机统一落在 <= 768 区间。横屏手机宽度 740-932 且为触屏，
//  用第二条 media 覆盖；平板竖屏 768+ 仍走桌面版。
export const MOBILE_MAX_WIDTH_PX = 768;

export function useIsMobile(): boolean {
  const narrow = useMediaQuery(`(max-width: ${MOBILE_MAX_WIDTH_PX - 1}px)`);
  const landscapePhone = useMediaQuery(
    "(max-width: 932px) and (pointer: coarse) and (orientation: landscape)"
  );
  return narrow || landscapePhone;
}
