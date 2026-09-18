import NextAuth from "next-auth";
import authConfig from "@/auth.config";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { nextUrl } = req;
  const session = req.auth;
  const isLoggedIn = !!session;
  const role = session?.user?.role;

  const isOwnerArea =
    nextUrl.pathname.startsWith("/dashboard") ||
    nextUrl.pathname.startsWith("/leads") ||
    nextUrl.pathname.startsWith("/live") ||
    nextUrl.pathname.startsWith("/settings");
  const isBrokerArea = nextUrl.pathname.startsWith("/broker");
  const isLoginPage = nextUrl.pathname === "/login";

  if (!isLoggedIn && (isOwnerArea || isBrokerArea)) {
    const loginUrl = new URL("/login", nextUrl);
    loginUrl.searchParams.set("callbackUrl", nextUrl.pathname);
    return Response.redirect(loginUrl);
  }

  if (isLoggedIn && isLoginPage) {
    return Response.redirect(new URL(role === "BROKER" ? "/broker/dashboard" : "/dashboard", nextUrl));
  }

  if (isLoggedIn && isBrokerArea && role !== "BROKER") {
    return Response.redirect(new URL("/dashboard", nextUrl));
  }

  if (isLoggedIn && isOwnerArea && role === "BROKER") {
    return Response.redirect(new URL("/broker/dashboard", nextUrl));
  }
});

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/leads/:path*",
    "/live/:path*",
    "/settings/:path*",
    "/broker/:path*",
    "/login",
  ],
};
