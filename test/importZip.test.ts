import { describe, it, expect } from "bun:test";
import { zipSync, strToU8 } from "fflate";
import { importPenZip } from "../src/model/importZip";

describe("Pen .zip package import", () => {
  it("extracts .pen document and resolves relative image assets from images/ folder", () => {
    const penJson = JSON.stringify({
      version: "2.17",
      children: [
        {
          id: "screen",
          type: "frame",
          width: 390,
          height: 844,
          children: [
            {
              id: "hero_photo",
              type: "frame",
              width: 350,
              height: 250,
              fill: { type: "image", url: "./images/cat.png" }
            },
            {
              id: "avatar",
              type: "ellipse",
              width: 48,
              height: 48,
              fill: { type: "image", url: "assets/user.jpg" }
            }
          ]
        }
      ]
    });

    const fakePng = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const fakeJpg = new Uint8Array([255, 216, 255, 224, 0, 16, 74, 70]);

    const zipBuffer = zipSync({
      "app.pen": strToU8(penJson),
      "images/cat.png": fakePng,
      "assets/user.jpg": fakeJpg
    });

    const doc = importPenZip(zipBuffer);

    expect(doc.version).toBe("2.17");
    expect(doc.children).toHaveLength(1);

    const screen = doc.children[0] as any;
    const hero = screen.children[0];
    const avatar = screen.children[1];

    expect(hero.fill.url).toMatch(/^(blob:|data:image\/png)/);
    expect(avatar.fill.url).toMatch(/^(blob:|data:image\/jpeg)/);
  });

  it("throws a descriptive error when no .pen or .json file exists in the zip", () => {
    const invalidZip = zipSync({
      "readme.txt": strToU8("just a text file")
    });

    expect(() => importPenZip(invalidZip)).toThrow("No .pen or .json design file found");
  });
});
