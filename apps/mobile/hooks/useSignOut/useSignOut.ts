import { useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { signOut } from "@/lib/auth/client";

export function useSignOut() {
	const router = useRouter();
	const queryClient = useQueryClient();
	const [isSigningOut, setIsSigningOut] = useState(false);

	const handleSignOut = useCallback(async () => {
		setIsSigningOut(true);
		try {
			await signOut();
			queryClient.clear();
			await Image.clearDiskCache().catch(() => {});
			router.replace("/(auth)/sign-in");
		} catch (error) {
			console.error("[auth/signOut] Failed to sign out:", error);
		} finally {
			setIsSigningOut(false);
		}
	}, [router, queryClient]);

	return { signOut: handleSignOut, isSigningOut };
}
