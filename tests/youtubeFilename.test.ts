import assert from 'node:assert/strict'
import test from 'node:test'
import { parseYouTubeFilename, sanitizeSongText } from '../src/utils/youtubeFilename.ts'

const cases = [
    ['en - 七月七日晴『不敢睜開眼，希望是我的幻覺。』【高音質_動態歌詞Lyrics】♫.m4a', '七月七日晴', 'en'],
    ['Eric周興哲《如果雨之後 The Chaos After You》Official Music Video.mp4', '如果雨之後 The Chaos After You', 'Eric周興哲'],
    ['MAYDAY五月天 [ 乾杯 Cheers ] Official Music Video.m4a', '乾杯 Cheers', 'MAYDAY五月天'],
    ['『MV』毛不易Mao Buyi - 消愁 官方高畫質 Official HD MV.m4a', '消愁', '毛不易Mao Buyi'],
    ['周杰倫 Jay Chou【稻香 Rice Field】-Official Music Video.m4a', '稻香 Rice Field', '周杰倫 Jay Chou'],
    ['《我的眼泪你的战利品》于冬然.mp4', '我的眼泪你的战利品', '于冬然'],
    ['F.I.R. 飛兒樂團 - Lydia (official 官方完整版MV).m4a', 'Lydia', 'F.I.R. 飛兒樂團'],
    ['#胡彦斌 #隔壁老樊 催泪对唱《那女孩对我说》怎么感觉隔壁老樊心里有放不下的女孩子？#音乐安利站【live】.mp4', '那女孩对我说', '胡彦斌 隔壁老樊'],
    ['G.E.M.【光年之外 LIGHT YEARS AWAY 】MV (電影《太空潛航者》中文主題曲) [HD] 鄧紫棋.mp4', '光年之外 LIGHT YEARS AWAY', 'G.E.M.'],
    ['Energy [ 星期五晚上 Friday Night ] Official Music Video.m4a', '星期五晚上 Friday Night', 'Energy'],
] as const

for (const [filename, title, artist] of cases) {
    test(filename, () => {
        const parsed = parseYouTubeFilename(filename)
        assert.equal(parsed.title, title)
        assert.equal(parsed.artist, artist)
        assert.ok(parsed.queries.some(query => query.includes(title)))
    })
}

test('keeps both orientations for an ambiguous bare dash name', () => {
    const parsed = parseYouTubeFilename('十年 - 陳奕迅『懷抱既然不能逗留』【動態歌詞Lyrics】.m4a')
    assert.deepEqual(parsed.queries.slice(0, 2), ['陳奕迅 十年', '十年 陳奕迅'])
})

test('removes promotional and lyrics noise locally', () => {
    const cleaned = sanitizeSongText('落在生命裡的光『你是落在我世界裡的一束光』【高音質_動態歌詞Lyrics】♫ #熱門')
    assert.equal(cleaned, '落在生命裡的光')
})
