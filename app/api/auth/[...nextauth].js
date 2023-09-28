import NextAuth from "next-auth";
import AzureADProvider from "next-auth/providers/azure-ad";

export default NextAuth({
  providers: [
    AzureADProvider({
      clientId: process.env.AZURE_AD_CLIENT_ID,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET,
      tenantId: process.env.AZURE_AD_TENANT_ID
      // You may include additional Azure AD options here
    }),
    // ...you can add more providers here if needed in the future
  ],
  // Additional NextAuth configurations go here (like session handling, JWT, etc.)
});
