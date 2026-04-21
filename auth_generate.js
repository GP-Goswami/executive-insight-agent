import "dotenv/config";
import { google } from "googleapis";

const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON), // ya JSON object
    scopes: [
        "https://www.googleapis.com/auth/webmasters.readonly",
        "https://www.googleapis.com/auth/analytics.readonly",
    ],
});

async function getToken() {
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();
    console.log("ACCESS TOKEN:", accessToken.token);
}

getToken();

// ya29.c.c0AZ4bNpZ-9_3hewIytVkPGu8WyugnfSR5sAcGjLX1abiFRca44R7WhKPKVdDLnhsTkkGrKVoiiEuR6SFT_imLt05PH86Jd73jTzjWtk0dTgdy9X86ha7dLYedHewanf_oqEX2-B8BisLHy52lrouCohjfbTmoikSXVLxN8t4ml55Q2RSc7T4-sBMsyESJoDP6Bz3nhHjT_Z3mELBCq6GXVHFzaqjl7whNddh0dxUgVT58ZFIt6Vc-FG8mJ0eiRQBsYt4LSAnt1kX4N_0N7QTBJYNeVTRLf7f0a7fcwHH7U_4IJmxdh7jlFFuBnE6CLIj4UpEwAEWofRY8DfW9Ca0KEA0HI-08eoWGiJILCdeKKtF-PrQIPBqJSj8lL385KIBqXf7mI4ezWmVWJpqF4QuW02ogviVYorMbU95J4qI-kbJRd-37_Uf3Otpwzz2g394lvX6YJfwcMtOe2SSl1ZRrnQ0R6edefB_ObIly4c4B1OyIkno385bJ1I6ZeZ1QvfXuYQi9MJUzgo_-tJ416kx3ZkweQXw0UOiguRfzh0QB9e0lgbXf-08sWuX-gjMscM46fa_yo0JM1x-xRVz8tbj0cxmxSsU4-nkt0IItRYWXyt-XwdIhtMzerj0e6Y2h5M7tvkd_WdSRJcszohW2u4q7jOhQwgUUhIXgci1cmQkhiX2kUvB-2uXZYRJ6-r-I5FBS0UsMehviU_rmXM1h4_p-ri70dp9Ocgt5S99j3B5RIfvc0_BUYztRZu6idSBBecrhfoh8jzoVZ6oaBMOvY0fQWcgsobjJ1zlQefdQ7ZtbqOQ8q4S_Uhu7x361nupUc9lUXj92VnievbzIk6BJF_OB-WU2Qtu5YWebv64lkZYav9jeudR0x-zhwIRFMuvu815VsR22-6exxYQwB50mmRU2v7SXejpJd-p0VJY2xorlcBWjB0BsbStUlik137nmX-Soxarj7i1sYZ-zaRr2nbaw2Sxk0i2deivO5Z7i77mXrVzJ68z3q27s5-5 