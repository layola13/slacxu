import { Box, Chip, Stack, Typography } from "@mui/material";

type Props = {
  enabled: boolean;
};

export function PetDock({ enabled }: Props) {
  return (
    <Box
      role="img"
      aria-label="Pet dock preview"
      sx={{
        height: 156,
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        overflow: "hidden",
        bgcolor: "background.default",
        position: "relative"
      }}
    >
      <Stack alignItems="center" justifyContent="center" sx={{ height: "100%" }} spacing={1}>
        <Chip size="small" label={enabled ? "Temporarily disabled" : "Disabled"} />
        <Typography variant="caption" color="text.secondary">
          Three.js pet dock is temporarily disabled to reduce renderer load.
        </Typography>
      </Stack>
    </Box>
  );
}
