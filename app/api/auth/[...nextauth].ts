console.log('Environment variables:', process.env.AZURE_AD_CLIENT_ID, process.env.AZURE_AD_CLIENT_SECRET, process.env.AZURE_AD_TENANT_ID);


import NextAuth from 'next-auth'
import AzureADProvider from 'next-auth/providers/azure-ad'

export default NextAuth({
  providers: [
    AzureADProvider({
      clientId: process.env.AZURE_AD_CLIENT_ID || "defaultClientId",
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET || "defaultClientSecret",
      tenantId: process.env.AZURE_AD_TENANT_ID || "defaultTenantId",
    }),
  ],
  callbacks: {
    async signIn(user, account, profile) {
      console.log('NextAuth signIn callback:', user, account, profile);
      return true;
    },
  },
});
