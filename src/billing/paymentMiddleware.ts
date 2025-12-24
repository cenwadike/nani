import "dotenv/config";
import { settlePayment, facilitator } from "thirdweb/x402";
import { createThirdwebClient } from "thirdweb";
import { arbitrumSepolia } from "thirdweb/chains";
import { NextFunction, Request, Response } from "express";

const { THIRDWEB_SECRET_KEY, PAY_TO } = process.env;

if (!THIRDWEB_SECRET_KEY)
  throw new Error(
    `Missing Thirdweb secret key: ${THIRDWEB_SECRET_KEY} environment variable`
  );
if (!PAY_TO)
  throw new Error(
    `Missing Server wallet address: ${PAY_TO} environment variable`
  );

const client = createThirdwebClient({
  secretKey: THIRDWEB_SECRET_KEY,
});

const thirdwebFacilitator = facilitator({
  client,
  serverWalletAddress: PAY_TO,
  waitUntil: "simulated",
});

// paymentMiddleware function is writing to have a static manual price set per protected route
export function paymentMiddleware(price: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const result = await settlePayment({
      resourceUrl: `${req.protocol}://${req.get("host")}${req.originalUrl}`,
      method: req.method,
      paymentData:
        typeof req.headers["x-payment"] === "string"
          ? req.headers["x-payment"]
          : null,
      payTo: PAY_TO,
      network: arbitrumSepolia,
      price: `${price}`,
      facilitator: thirdwebFacilitator,
      routeConfig: {
        description: "Access to paid content", // TODO write a good description
        mimeType: "application/json",
        maxTimeoutSeconds: 60 * 60, // 1 hour signature expiration
      },
    });

    if (result.status === 200) {
      // Set payment receipt headers and continue
      Object.entries(result.responseHeaders).forEach(([key, value]) => {
        res.setHeader(key, value);
      });
      next();
    } else {
      // Return payment required response
      res
        .status(result.status)
        .set(result.responseHeaders)
        .json(result.responseBody);
    }
  };
}
