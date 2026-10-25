import { useMemo, useState } from "react";
import {
  Box,
  Chip,
  FormControl,
  ListSubheader,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material/Select";
import type { TranslateFn } from "../i18n";
import type { FreebuffSessionStatus, ModelEntry } from "../state/codexClient";

export interface ComposerModelSelectProps {
  selectedModel: string;
  models: ModelEntry[];
  activeGroupId: string | null | undefined;
  freebuffSession: FreebuffSessionStatus | null;
  t: TranslateFn;
  onChange: (model: string) => void;
}

function modelFilterText(entry: ModelEntry): string {
  const value = entry.model ?? entry.id ?? "";
  const display = entry.displayName ?? "";
  return `${value} ${display}`.toLowerCase();
}

export function ComposerModelSelect({
  selectedModel,
  models,
  activeGroupId,
  freebuffSession,
  t,
  onChange
}: ComposerModelSelectProps) {
  const [filter, setFilter] = useState("");

  const filteredModels = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return models;
    return models.filter((entry) => modelFilterText(entry).includes(q));
  }, [filter, models]);

  const handleClose = () => {
    setFilter("");
  };

  return (
    <FormControl size="small" sx={{ minWidth: 150, maxWidth: 220 }}>
      <Select
        value={selectedModel}
        displayEmpty
        inputProps={{ "aria-label": t("app.model") }}
        data-testid="composer-model-select"
        renderValue={(value: unknown) => {
          const selectedValue = typeof value === "string" ? value : "";
          const selected = models.find((entry) => (entry.model ?? entry.id ?? "") === selectedValue);
          const displayName = (selected?.displayName ?? selectedValue) || t("app.model");
          const isFreebuffActive = activeGroupId === "freebuff" && freebuffSession?.active && freebuffSession.model === selectedValue;
          return (
            <Stack direction="row" spacing={0.75} alignItems="center" sx={{ overflow: "hidden" }}>
              {isFreebuffActive && (
                <Box
                  component="span"
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    bgcolor: "success.main",
                    boxShadow: "0 0 5px rgba(76, 175, 80, 0.9)",
                    flexShrink: 0
                  }}
                />
              )}
              <Typography variant="inherit" noWrap sx={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                {displayName}
              </Typography>
            </Stack>
          );
        }}
        onChange={(event: SelectChangeEvent<string>) => {
          onChange(event.target.value);
        }}
        onClose={handleClose}
        MenuProps={{
          autoFocus: false,
          PaperProps: { sx: { maxHeight: 420 } },
          MenuListProps: { autoFocusItem: false, sx: { pt: 0 } }
        }}
        sx={{ height: 32, fontSize: 13, "& .MuiSelect-select": { py: 0.5, overflow: "hidden", textOverflow: "ellipsis" } }}
      >
        <ListSubheader
          sx={{
            position: "sticky",
            top: 0,
            zIndex: 1,
            bgcolor: "background.paper",
            px: 1,
            py: 1,
            borderBottom: "1px solid",
            borderColor: "divider"
          }}
        >
          <TextField
            autoFocus
            size="small"
            fullWidth
            placeholder={t("app.modelFilter")}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            inputProps={{ "aria-label": t("app.modelFilter"), "data-testid": "composer-model-filter" }}
            sx={{ "& .MuiInputBase-input": { py: 0.75, fontSize: 13 } }}
          />
          {filter.trim() ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", pt: 0.5 }}>
              {filteredModels.length}/{models.length}
            </Typography>
          ) : null}
        </ListSubheader>
        {filteredModels.map((entry) => {
          const value = entry.model ?? entry.id ?? "";
          const isFreebuff = activeGroupId === "freebuff";
          const isActiveSlot = isFreebuff && freebuffSession?.active && freebuffSession.model === value;
          return (
            <MenuItem
              key={value}
              value={value}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1
              }}
            >
              {isFreebuff && (
                <Box
                  component="span"
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    bgcolor: isActiveSlot ? "success.main" : "text.disabled",
                    opacity: isActiveSlot ? 1 : 0.35,
                    boxShadow: isActiveSlot ? "0 0 6px rgba(76, 175, 80, 0.8)" : "none",
                    flexShrink: 0
                  }}
                />
              )}
              <Typography variant="body2" sx={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                {entry.displayName ?? value}
              </Typography>
              {isFreebuff && (
                <Chip
                  size="small"
                  label={
                    freebuffSession?.freebucks?.prices?.[value] !== undefined
                      ? (freebuffSession.freebucks.prices[value] === 0 ? "0 FB (限免)" : `${freebuffSession.freebucks.prices[value]} FB`)
                      : (value.includes("solar") ? "0 FB (限免)" : "5 FB")
                  }
                  variant="outlined"
                  sx={{ height: 18, fontSize: 10, px: 0.5, flexShrink: 0, borderColor: "divider" }}
                />
              )}
              {isActiveSlot && (
                <Chip
                  size="small"
                  label="当前激活"
                  color="success"
                  variant="outlined"
                  sx={{ height: 18, fontSize: 10, px: 0.5, flexShrink: 0 }}
                />
              )}
            </MenuItem>
          );
        })}
        {filteredModels.length === 0 ? (
          <MenuItem value="" disabled>
            <Typography variant="body2" color="text.secondary">
              {t("app.noMatchingModels")}
            </Typography>
          </MenuItem>
        ) : null}
      </Select>
    </FormControl>
  );
}
