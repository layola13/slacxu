import { Box } from "@mui/material";

type Props = {
  active?: boolean;
  running: boolean;
  runningLabel: string;
  threadId: string;
};

export function ThreadStatusDot({ active = false, running, runningLabel, threadId }: Props) {
  return (
    <Box
      component="span"
      role={running ? "status" : undefined}
      aria-label={running ? runningLabel : undefined}
      aria-hidden={running ? undefined : true}
      data-testid={running ? "running-thread-pulse" : undefined}
      data-thread-id={threadId}
      sx={{
        width: 10,
        height: 10,
        flex: "0 0 10px",
        display: "grid",
        placeItems: "center"
      }}
    >
      <Box
        component="span"
        sx={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          bgcolor: running ? "success.main" : active ? "primary.main" : "transparent",
          // A static glow scales to hundreds of agents without creating one
          // compositor animation layer per status dot.
          boxShadow: running ? "0 0 5px currentColor" : "none"
        }}
      />
    </Box>
  );
}
