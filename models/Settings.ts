import mongoose, { Schema } from "mongoose";

const settingsSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    googleRefreshToken: { type: String },
    spreadsheetId: { type: String },
    analysisSheetId: { type: String },
  },
  { timestamps: true }
);

export const Settings = mongoose.models.Settings ?? mongoose.model("Settings", settingsSchema);
