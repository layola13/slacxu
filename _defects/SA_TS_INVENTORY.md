# sa_std 的 TS 语义库清单（转换必须优先绑定，禁止重复造桩）

来源：Colab sci/sa_std 实测（2026-10-26）。这些库就是为 TS→SA 映射准备的：
转换中遇到 JS String/Array/Math 方法、tree-sitter、async 运行时，先查这里，
有对应的直接 `@import` 绑定并在缺陷日志里把条目改记为「已绑 sa_std ts 面」，
不要再以手写扫描/占位 extern 近似。

## ts_string.sa（@import "sa_std/ts_string.sa"，{ptr,len} 句柄模型）
@ts_str_equals @ts_str_slice @ts_str_split @ts_str_trim @ts_str_char_at
@ts_str_compare @ts_str_parse_int @ts_str_arr_scan @ts_str_hex_i0
（底层还有 string.sai 的 sa_string_index_of 等）

## ts_array.sa（@import "sa_std/ts_array.sa"）
@ts_arr_push_word @ts_arr_pop @ts_arr_shift @ts_arr_splice @ts_arr_slice_copy
@ts_arr_concat2 @ts_arr_flat @ts_arr_clone_flat @ts_arr_clone_deep @ts_arr_sort
@ts_arr_sort_str @ts_arr_reverse @ts_arr_fill @ts_arr_copywithin @ts_arr_join_strs
@ts_arr_join_vals @ts_arr_join_append @ts_arr_entries @ts_arr_keys @ts_arr_with
@ts_arr_tosorted @ts_arr_toreversed @ts_arr_tospliced @ts_arr_mkcopy
@ts_arr_append_slice @ts_arr_copy_range @ts_arr_rotr1 @ts_arr_scan

## ts_math.sa（@import "sa_std/ts_math.sa"）
@ts_math_iabs @ts_math_ilog10 @ts_math_imul @ts_math_ipow @ts_math_isign
@ts_math_isqrt @ts_math_minmax @ts_math_rounding @ts_math_spread_minmax

## tree-sitter externs（tree_sitter.sai，sa_ts_* 共 16）
sa_ts_available sa_ts_parse sa_ts_parser_new sa_ts_parser_free
sa_ts_parser_set_language sa_ts_tree_free sa_ts_tree_root sa_ts_tree_sexp
sa_ts_node_child sa_ts_node_child_by_field sa_ts_node_child_count
sa_ts_node_named_child_count sa_ts_node_text sa_ts_node_type sa_ts_node_free
sa_ts_node_byte_range

## async 运行时面（sa_std 内置）
async.sla（sched_* 调度 + block_on_timeout）、future.sa、core/waker.sa、
sync/mpsc.sa、sync/mutex.sa、thread.sa（pthread_spawn 等）——async/Promise
类缺陷在修复阶段优先用这套面评估，不要默认「无对应」。

## 其他已内置（转换时一并查）
collections（btree_map.sa/btree_set.sa 等 Map/Set 对应）、encoding（json/toml）、
crypto.sai、compress.sai、http_client/server、process（spawn_bidi）、fs 全面。
