import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;

declare global {
  var _mongooseConn: Promise<typeof mongoose> | undefined;
}

export function connectMongo(): Promise<typeof mongoose> {
  if (!MONGODB_URI) throw new Error("MONGODB_URI is not configured");

  if (!global._mongooseConn) {
    global._mongooseConn = mongoose.connect(MONGODB_URI).catch((err) => {
      global._mongooseConn = undefined;
      throw err;
    });
  }
  return global._mongooseConn;
}
