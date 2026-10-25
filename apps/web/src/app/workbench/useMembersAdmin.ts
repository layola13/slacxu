import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import {
  allocateMemberBalance,
  createMember,
  deleteMember,
  fetchSessionToken,
  listMembers,
  updateMember,
} from "../../state/codexClient";
import type { AuthSession, AuthUser, PermissionPresetId } from "@codex-ui/shared";
import { formatErrorText } from "./appUtils";
import type { ClientState } from "../../state/codexClient";

export function useMembersAdmin(input: {
  state: Pick<ClientState, "token">;
  authSession: AuthSession | null;
  setAuthSession: Dispatch<SetStateAction<AuthSession | null>>;
}) {
  const { state, authSession, setAuthSession } = input;
  const [members, setMembers] = useState<AuthUser[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);

  const reloadMembers = useCallback(async () => {
    if (!state.token || authSession?.user?.role !== "admin") {
      setMembers([]);
      return;
    }
    setMembersLoading(true);
    setMembersError(null);
    try {
      setMembers(await listMembers(state.token));
    } catch (error) {
      setMembersError(formatErrorText(error));
    } finally {
      setMembersLoading(false);
    }
  }, [authSession?.user?.role, state.token]);

  const handleCreateMember = useCallback(
    async (input: {
      email: string;
      password: string;
      username?: string;
      role?: "admin" | "user";
      maxPermission?: PermissionPresetId;
      allowWrite?: boolean;
      allowNetwork?: boolean;
      allowDangerBypass?: boolean;
      balance?: number;
      concurrency?: number;
      notes?: string;
      allowedProviderIds?: string[];
    }) => {
      if (!state.token) throw new Error("Not authenticated");
      await createMember(state.token, input);
      await reloadMembers();
    },
    [reloadMembers, state.token]
  );

  const handleUpdateMember = useCallback(
    async (id: string, input: Record<string, unknown>) => {
      if (!state.token) throw new Error("Not authenticated");
      await updateMember(state.token, id, input);
      await reloadMembers();
    },
    [reloadMembers, state.token]
  );

  const handleDeleteMember = useCallback(
    async (id: string) => {
      if (!state.token) throw new Error("Not authenticated");
      await deleteMember(state.token, id);
      await reloadMembers();
    },
    [reloadMembers, state.token]
  );

  const handleAllocateMemberBalance = useCallback(
    async (id: string, amount: number, operation: "set" | "add" | "subtract" = "add", notes?: string) => {
      if (!state.token) throw new Error("Not authenticated");
      await allocateMemberBalance(state.token, id, { amount, operation, notes });
      await reloadMembers();
      // refresh self session balance if admin topped up themselves
      if (authSession?.user?.id === id) {
        try {
          const me = await fetchSessionToken(state.token);
          setAuthSession(me);
        } catch {
          /* ignore */
        }
      }
    },
    [authSession?.user?.id, reloadMembers, state.token]
  );
  return {
    members,
    setMembers,
    membersLoading,
    setMembersLoading,
    membersError,
    setMembersError,
    reloadMembers,
    handleCreateMember,
    handleUpdateMember,
    handleDeleteMember,
    handleAllocateMemberBalance,
  };
}
