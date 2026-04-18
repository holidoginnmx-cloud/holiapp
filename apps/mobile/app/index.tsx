import { Redirect } from "expo-router";

export default function Index() {
  console.log("🏁 [index.tsx] MOUNTED — redirecting to auth/login");
  return <Redirect href="/(auth)/login" />;
}
